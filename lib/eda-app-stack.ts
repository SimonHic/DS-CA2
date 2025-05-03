import * as cdk from "aws-cdk-lib";
import * as lambdanode from "aws-cdk-lib/aws-lambda-nodejs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import * as events from "aws-cdk-lib/aws-lambda-event-sources";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import * as iam from "aws-cdk-lib/aws-iam";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb"

import { Construct } from "constructs";
import { eventNames } from "node:process";
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class EDAAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const imagesBucket = new s3.Bucket(this, "images", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      publicReadAccess: false,
    });

      // Integration infrastructure

  const imageDLQ = new sqs.Queue(this, "img-dead-letter-queue",{
    queueName: "ImageDLQ",
    retentionPeriod: cdk.Duration.minutes(5),
  })    
  const imageProcessQueue = new sqs.Queue(this, "img-created-queue", {
    receiveMessageWaitTime: cdk.Duration.seconds(5),
    deadLetterQueue:{
      maxReceiveCount: 1,
      queue: imageDLQ,
    }
  });

  const mailerQ = new sqs.Queue(this, "mailer-queue", {
    receiveMessageWaitTime: cdk.Duration.seconds(10),
  });

  const newImageTopic = new sns.Topic(this, "NewImageTopic", {
    displayName: "New Image topic",
  }); 

  const imageTable = new dynamodb.Table(this, "ImagesTable", {
    partitionKey: {name: "imageId", type: dynamodb.AttributeType.STRING},
    billingMode:dynamodb.BillingMode.PAY_PER_REQUEST,
    removalPolicy: cdk.RemovalPolicy.DESTROY
  })
  
  /* newImageTopic.addSubscription(
    new subs.SqsSubscription(imageProcessQueue)
  ); */

  newImageTopic.addSubscription(new subs.SqsSubscription(mailerQ));

  // Lambda functions

  const processImageFn = new lambdanode.NodejsFunction(
    this,
    "ProcessImageFn",
    {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: `${__dirname}/../lambdas/processImage.ts`,
      timeout: cdk.Duration.seconds(15),
      memorySize: 128,
      environment:{
        IMAGE_TABLE_NAME: imageTable.tableName,
      },
    }
  );

  const removeImageFn = new lambdanode.NodejsFunction(this, "RemoveImageFn",{
    runtime:lambda.Runtime.NODEJS_22_X,
    memorySize: 128,
    timeout: cdk.Duration.seconds(10),
    entry: `${__dirname}/../lambdas/removeImage.ts`,
  })

  const updateMetadataFn = new lambdanode.NodejsFunction(this, "UpdateMetadataFn",{
    runtime: lambda.Runtime.NODEJS_22_X,
    entry: `${__dirname}/../lambdas/updateMetadata.ts`,
    timeout: cdk.Duration.seconds(10),
    memorySize: 128,
    environment:{
      IMAGE_TABLE_NAME: imageTable.tableName
    }
  })

  newImageTopic.addSubscription(new subs.LambdaSubscription(updateMetadataFn,{
    filterPolicy:{
      metadata_type: sns.SubscriptionFilter.stringFilter({
        allowlist: ["Name", "Date", "Caption"],
      }),
    },
  })
);

// Make sure only S3 stuff is allowed
newImageTopic.addSubscription(new subs.SqsSubscription(imageProcessQueue,{
  filterPolicyWithMessageBody:{
    Records: sns.FilterOrPolicy.policy({eventName:
      sns.FilterOrPolicy.filter(sns.SubscriptionFilter.stringFilter({
        allowlist: ["ObjectCreated:Put", "ObjectRemoved:Delete"],
      })),
    })
  }
}));

  const mailerFn = new lambdanode.NodejsFunction(this, "mailer-function", {
    runtime: lambda.Runtime.NODEJS_16_X,
    memorySize: 1024,
    timeout: cdk.Duration.seconds(3),
    entry: `${__dirname}/../lambdas/mailer.ts`,
  });
  
  mailerFn.addToRolePolicy(
    new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "ses:SendEmail",
        "ses:SendRawEmail",
        "ses:SendTemplatedEmail",
      ],
      resources: ["*"],
    })
  );


  // S3 --> SQS
  imagesBucket.addEventNotification(
    s3.EventType.OBJECT_CREATED,
    new s3n.SnsDestination(newImageTopic)
  );

 // SQS --> Lambda
  const newImageEventSource = new events.SqsEventSource(imageProcessQueue, {
    batchSize: 5,
    maxBatchingWindow: cdk.Duration.seconds(5),
  });

  const newImageMailEventSource = new events.SqsEventSource(mailerQ, {
    batchSize: 5,
    maxBatchingWindow: cdk.Duration.seconds(5),
  }); 

  processImageFn.addEventSource(newImageEventSource);
  mailerFn.addEventSource(newImageMailEventSource);

  // Permissions

  imagesBucket.grantRead(processImageFn);
  imageTable.grantReadWriteData(processImageFn);
  imagesBucket.grantDelete(removeImageFn);
  imageTable.grantWriteData(updateMetadataFn);

  // DLQ --> Remove Image Lambda
  removeImageFn.addEventSource(
    new events.SqsEventSource(imageDLQ,{
      batchSize: 1,
      maxBatchingWindow: cdk.Duration.seconds(5),
    })
  )

  // Output
  
  new cdk.CfnOutput(this, "bucketName", {
    value: imagesBucket.bucketName,
  });
  }
}
