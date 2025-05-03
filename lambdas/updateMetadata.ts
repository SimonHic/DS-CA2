import { SNSHandler } from "aws-lambda";
import {DynamoDBClient} from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const client = DynamoDBDocumentClient.from(new DynamoDBClient());
const tableName = process.env.IMAGE_TABLE_NAME || "ImagesTable";

export const handler: SNSHandler = async (event) => {
    console.log("SNS Event:", JSON.stringify(event));
    for(const record of event.Records){
        const metadataType = record.Sns.MessageAttributes?.metadata_type?.Value;

        if(!metadataType || !["Name", "Date", "Caption"].includes(metadataType)){
            console.error("Missing or invalid metadata_type attribute:", metadataType);
            continue;
        }
        try{
            const{id, value} = JSON.parse(record.Sns.Message);
            console.log(`Attempting to update ${id} with ${metadataType}: ${value}`);
            await client.send(new UpdateCommand({
                TableName: tableName,
                Key: {imageId: id},
                // Avoid reserved word conflicts (name) by assigning a variable (#attr) so DynamoDB wont interpret as a reserved one
                UpdateExpression: `SET #attr = :val`,
                // Make stored metadata consistent format in image table
                ExpressionAttributeNames:{
                    "#attr": metadataType.toLowerCase(),
                },
                ExpressionAttributeValues:{
                    ":val": value,
                },
            }));
        }catch(err){
            console.error("Failed to update the metadata:", err)
        }
    }
  };