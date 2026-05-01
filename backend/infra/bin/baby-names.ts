#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { BabyNamesStack } from '../lib/baby-names-stack';

const app = new cdk.App();
new BabyNamesStack(app, 'BabyNamesStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
