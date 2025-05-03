/* eslint-disable import/extensions, import/no-absolute-path */
import { SQSHandler } from "aws-lambda";
import {

  S3Client,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

const s3 = new S3Client();

export const handler: SQSHandler = async (event) => {
  console.log("DLQ - removeImage.ts triggered");
  for (const record of event.Records) {
    const recordBody = JSON.parse(record.body);        // SQS message and gets carried by DLQ
    const snsMessage = JSON.parse(recordBody.Message); // Parse SNS message

    if (snsMessage.Records) {
      for (const messageRecord of snsMessage.Records) {
        const s3e = messageRecord.s3;
        const bucketName = s3e.bucket.name;
        // Object key may have spaces or unicode non-ASCII characters.
        const objectKey = decodeURIComponent(s3e.object.key.replace(/\+/g, " "));

        try {
            // Log what object is being deleted from what specific bucket
            console.log(`Deleting: ${objectKey} from ${bucketName}`)
            // Delete the invalid file found
            await s3.send(
                new DeleteObjectCommand({
                    Bucket: bucketName,
                    Key: objectKey,
                })
            );
          } catch(error){
            console.error("Error - Failed to delete object", error)
          }
        }
      }
    }
  };
