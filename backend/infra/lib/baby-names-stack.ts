import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export class BabyNamesStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // --- DynamoDB: name metadata ---
    const namesTable = new dynamodb.Table(this, 'NamesTable', {
      tableName: 'Names',
      partitionKey: { name: 'name', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    namesTable.addGlobalSecondaryIndex({
      indexName: 'origin-index',
      partitionKey: { name: 'origin', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'rank', type: dynamodb.AttributeType.NUMBER },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // --- S3: raw data and user uploads ---
    const dataBucket = new s3.Bucket(this, 'DataBucket', {
      bucketName: `baby-names-data-${this.account}`,
      versioned: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // --- VPC ---
    const vpc = new ec2.Vpc(this, 'BabyNamesVpc', {
      ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        { name: 'public',   subnetType: ec2.SubnetType.PUBLIC,           cidrMask: 24 },
        { name: 'isolated', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });

    // Free DynamoDB gateway endpoint — lets Lambda in isolated subnet reach DynamoDB
    vpc.addGatewayEndpoint('DynamoEndpoint', {
      service: ec2.GatewayVpcEndpointAwsService.DYNAMODB,
    });

    // --- Secrets Manager: DB credentials ---
    const dbSecret = new secretsmanager.Secret(this, 'DbSecret', {
      secretName: 'baby-names/db-credentials',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'babynames' }),
        generateStringKey: 'password',
        excludePunctuation: true,
      },
    });

    // --- Security groups ---
    const lambdaSg = new ec2.SecurityGroup(this, 'LambdaSg', {
      vpc,
      description: 'API Lambda',
      allowAllOutbound: true,
    });

    const rdsSg = new ec2.SecurityGroup(this, 'RdsSg', {
      vpc,
      description: 'RDS PostgreSQL - Lambda only',
    });
    rdsSg.addIngressRule(lambdaSg, ec2.Port.tcp(5432), 'Lambda access');

    // --- RDS PostgreSQL: popularity time-series (private) ---
    const db = new rds.DatabaseInstance(this, 'PopularityDb', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16,
      }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      credentials: rds.Credentials.fromSecret(dbSecret),
      databaseName: 'babynames',
      allocatedStorage: 20,
      storageType: rds.StorageType.GP2,
      multiAz: false,
      publiclyAccessible: false,
      securityGroups: [rdsSg],
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      removalPolicy: cdk.RemovalPolicy.SNAPSHOT,
      deletionProtection: false,
    });

    // --- DynamoDB: name tags (definitions + assignments, per deviceId) ---
    const nameTagsTable = new dynamodb.Table(this, 'NameTagsTable', {
      tableName: 'NameTags',
      partitionKey: { name: 'deviceId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // --- Lambda: API handler ---
    const apiFunction = new NodejsFunction(this, 'ApiFunction', {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, '../functions/api/src/handler.ts'),
      handler: 'handler',
      projectRoot: path.join(__dirname, '..'),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [lambdaSg],
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        DB_HOST: db.instanceEndpoint.hostname,
        DB_NAME: 'babynames',
        DB_USER: 'babynames',
        DB_PASSWORD: dbSecret.secretValueFromJson('password').unsafeUnwrap(),
        TAGS_TABLE: nameTagsTable.tableName,
      },
      bundling: {
        externalModules: [],
      },
    });

    // --- DynamoDB: list sessions ---
    const listsTable = new dynamodb.Table(this, 'ListsTable', {
      tableName: 'Lists',
      partitionKey: { name: 'listId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    listsTable.addGlobalSecondaryIndex({
      indexName: 'code-index',
      partitionKey: { name: 'code', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    namesTable.grantReadData(apiFunction);
    apiFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:Query', 'dynamodb:Scan', 'dynamodb:GetItem'],
      resources: [namesTable.tableArn, `${namesTable.tableArn}/index/*`],
    }));
    apiFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:PutItem', 'dynamodb:GetItem', 'dynamodb:UpdateItem', 'dynamodb:Query'],
      resources: [listsTable.tableArn, `${listsTable.tableArn}/index/*`],
    }));

    apiFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:PutItem', 'dynamodb:GetItem', 'dynamodb:DeleteItem', 'dynamodb:Query'],
      resources: [nameTagsTable.tableArn],
    }));

    // --- Bedrock Runtime VPC Interface Endpoint (lets in-VPC Lambdas call Bedrock without internet) ---
    const bedrockEndpointSg = new ec2.SecurityGroup(this, 'BedrockEndpointSg', {
      vpc,
      description: 'Bedrock Runtime VPC Endpoint',
    });
    bedrockEndpointSg.addIngressRule(lambdaSg, ec2.Port.tcp(443), 'Lambda to Bedrock');

    new ec2.InterfaceVpcEndpoint(this, 'BedrockRuntimeEndpoint', {
      vpc,
      service: new ec2.InterfaceVpcEndpointService(`com.amazonaws.${this.region}.bedrock-runtime`),
      subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [bedrockEndpointSg],
      privateDnsEnabled: true,
    });

    // --- Lambda: Consultant handler (in VPC — needs DB + Bedrock via VPC endpoint) ---
    const consultantFunction = new NodejsFunction(this, 'ConsultantFunction', {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, '../functions/api/src/handler-consultant.ts'),
      handler: 'handler',
      projectRoot: path.join(__dirname, '..'),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [lambdaSg],
      timeout: cdk.Duration.seconds(60),
      memorySize: 512,
      environment: {
        DB_HOST: db.instanceEndpoint.hostname,
        DB_NAME: 'babynames',
        DB_USER: 'babynames',
        DB_PASSWORD: dbSecret.secretValueFromJson('password').unsafeUnwrap(),
        BEDROCK_REGION: this.region,
      },
      bundling: { externalModules: [] },
    });

    consultantFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:BatchGetItem', 'dynamodb:GetItem', 'dynamodb:Query'],
      resources: [namesTable.tableArn, `${namesTable.tableArn}/index/*`],
    }));
    consultantFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:GetItem'],
      resources: [listsTable.tableArn],
    }));
    consultantFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: [
        `arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-3-5-sonnet-20241022-v2:0`,
        `arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-3-haiku-20240307-v1:0`,
        `arn:aws:bedrock:${this.region}::foundation-model/amazon.nova-micro-v1:0`,
      ],
    }));

    // --- Lambda: AI chat handler (outside VPC — needs internet for Bedrock) ---
    const aiFunction = new NodejsFunction(this, 'AiFunction', {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, '../functions/api/src/handler-ai.ts'),
      handler: 'handler',
      projectRoot: path.join(__dirname, '..'),
      timeout: cdk.Duration.seconds(60),
      memorySize: 256,
      environment: {
        NAMES_TABLE: namesTable.tableName,
        LISTS_TABLE: listsTable.tableName,
        BEDROCK_REGION: this.region,
      },
      bundling: { externalModules: [] },
    });

    aiFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:Scan', 'dynamodb:BatchGetItem'],
      resources: [namesTable.tableArn, `${namesTable.tableArn}/index/*`],
    }));
    aiFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:GetItem'],
      resources: [listsTable.tableArn],
    }));
    aiFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: [`arn:aws:bedrock:${this.region}::foundation-model/amazon.nova-lite-v1:0`],
    }));

    // --- API Gateway ---
    const api = new apigateway.RestApi(this, 'BabyNamesApi', {
      restApiName: 'BabyNamesApi',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: ['GET', 'POST', 'DELETE', 'PUT'],
      },
    });

    const integration = new apigateway.LambdaIntegration(apiFunction, { allowTestInvoke: false });

    // /names routes
    const names = api.root.addResource('names');
    names.addMethod('GET', integration);
    names.addResource('search').addMethod('GET', integration);
    names.addResource('rankings').addMethod('GET', integration);
    names.addResource('batch').addMethod('GET', integration);
    const nameParam = names.addResource('{name}');
    nameParam.addMethod('GET', integration);
    nameParam.addResource('popularity').addMethod('GET', integration);
    nameParam.addResource('rank').addMethod('GET', integration);
    nameParam.addResource('comparable').addMethod('GET', integration);
    const nameTags = nameParam.addResource('tags');
    nameTags.addMethod('PUT', integration);

    // /recommendations + /swipe + /onboarding routes
    api.root.addResource('recommendations').addMethod('GET', integration);
    api.root.addResource('swipe').addMethod('POST', integration);
    api.root.addResource('swipes').addMethod('GET', integration);
    api.root.addResource('onboarding').addMethod('POST', integration);


    // /tags routes
    const tags = api.root.addResource('tags');
    tags.addMethod('GET', integration);
    tags.addMethod('POST', integration);
    tags.addResource('assignments').addMethod('GET', integration);
    tags.addResource('{tagId}').addMethod('DELETE', integration);

    // /ai routes
    const aiIntegration = new apigateway.LambdaIntegration(aiFunction, { allowTestInvoke: false });
    api.root.addResource('ai').addResource('chat').addMethod('POST', aiIntegration);

    // /consultant routes
    const consultantIntegration = new apigateway.LambdaIntegration(consultantFunction, { allowTestInvoke: false });
    const consultant = api.root.addResource('consultant');
    consultant.addResource('session').addMethod('POST', consultantIntegration);
    consultant.addResource('feedback').addMethod('POST', integration);

    // /lists routes
    const lists = api.root.addResource('lists');
    lists.addMethod('POST', integration);
    lists.addResource('join').addMethod('POST', integration);
    const listParam = lists.addResource('{listId}');
    listParam.addMethod('GET', integration);
    listParam.addResource('partner-tags').addMethod('GET', integration);
    const listNames = listParam.addResource('names');
    listNames.addMethod('POST', integration);
    listNames.addResource('{name}').addMethod('DELETE', integration);
    listParam.addResource('spelling').addMethod('PUT', integration);

    // /auth routes
    const auth = api.root.addResource('auth');
    auth.addResource('migrate').addMethod('POST', integration);

    // --- Cognito User Pool ---
    const userPool = new cognito.UserPool(this, 'BabyNamesUserPool', {
      userPoolName: 'BabyNamesUserPool',
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: false,
        requireUppercase: false,
        requireDigits: false,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // App Client (email/password only for now — Apple/Google IdPs added when credentials ready)
    // To add social login: update babynames/social-auth in Secrets Manager with real
    // credentials, then add AppleIdp + GoogleIdp resources and include them in supportedIdentityProviders.
    const userPoolClient = new cognito.UserPoolClient(this, 'BabyNamesAppClient', {
      userPool,
      userPoolClientName: 'BabyNamesApp',
      generateSecret: false,
      authFlows: {
        userSrp: true,      // secure password auth from mobile
        userPassword: true, // fallback for SDK compatibility
      },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.PROFILE,
        ],
        callbackUrls: ['babynames://auth/callback'],
        logoutUrls:   ['babynames://auth/logout'],
      },
      supportedIdentityProviders: [
        cognito.UserPoolClientIdentityProvider.COGNITO,
      ],
    });

    // Hosted UI domain — required for social login OAuth redirect handling
    const cognitoDomain = userPool.addDomain('BabyNamesDomain', {
      cognitoDomain: { domainPrefix: 'babynames-auth' },
    });

    // --- Outputs ---
    new cdk.CfnOutput(this, 'ApiUrl',            { value: api.url });
    new cdk.CfnOutput(this, 'NamesTableName',    { value: namesTable.tableName });
    new cdk.CfnOutput(this, 'ListsTableName',    { value: listsTable.tableName });
    new cdk.CfnOutput(this, 'DataBucketName',    { value: dataBucket.bucketName });
    new cdk.CfnOutput(this, 'DbEndpoint',        { value: db.instanceEndpoint.hostname });
    new cdk.CfnOutput(this, 'DbSecretArn',       { value: dbSecret.secretArn });
    new cdk.CfnOutput(this, 'UserPoolId',        { value: userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId',  { value: userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, 'CognitoDomain',     { value: cognitoDomain.baseUrl() });
  }
}
