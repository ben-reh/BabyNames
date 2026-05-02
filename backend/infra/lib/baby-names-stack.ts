import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
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

    // GSI for querying by origin
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

    // --- VPC for RDS ---
    const vpc = new ec2.Vpc(this, 'BabyNamesVpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          name: 'isolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
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

    // --- RDS PostgreSQL db.t3.micro: popularity time-series ---
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
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      removalPolicy: cdk.RemovalPolicy.SNAPSHOT,
      deletionProtection: false,
    });

    // --- Outputs ---
    new cdk.CfnOutput(this, 'NamesTableName', { value: namesTable.tableName });
    new cdk.CfnOutput(this, 'DataBucketName', { value: dataBucket.bucketName });
    new cdk.CfnOutput(this, 'DbEndpoint', { value: db.instanceEndpoint.hostname });
    new cdk.CfnOutput(this, 'DbSecretArn', { value: dbSecret.secretArn });
  }
}
