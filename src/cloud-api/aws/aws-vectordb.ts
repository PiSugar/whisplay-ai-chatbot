import {
  S3VectorsClient,
  ListIndexesCommand,
  CreateIndexCommand,
  DeleteIndexCommand,
  PutVectorsCommand,
  QueryVectorsCommand,
  GetVectorsCommand,
  ListVectorsCommand,
  DeleteVectorsCommand,
  GetIndexCommand
} from "@aws-sdk/client-s3vectors";
import type {
  DistanceMetric,
  PutInputVector
} from "@aws-sdk/client-s3vectors";
import { VectorDBClass } from "../interface";
import { AWS_REGION, getAwsCredentials, hasAwsCredentials, awsS3VectorBucket } from "./aws";

function convertIndexNameFromWhisplay(indexName: string): string {
  return indexName.replace(/_/g, "-");
}

function convertIndexNameToWhisplay(indexName: string): string {
  return indexName.replace(/-/g, "_");
}

function convertFilter(filter?: any): Record<string, any> | undefined {
  if (filter && filter.must && Array.isArray(filter.must) && filter.must.length > 0) {
    if (filter.must.length === 1) {
      const cond = filter.must[0];
      if (cond.key && cond.match && cond.match.value !== undefined) {
        return { [cond.key]: { "$eq": cond.match.value } };
      }
    } else {
      const andConditions: any[] = [];
      for (const cond of filter.must) {
        if (cond.key && cond.match && cond.match.value !== undefined) {
          andConditions.push({ [cond.key]: { "$eq": cond.match.value } });
        }
      }
      if (andConditions.length > 1) {
        return { "$and": andConditions };
      } else if (andConditions.length === 1) {
        return andConditions[0];
      }
    }
  }
  return undefined;
}

function applyLocalFilter(points: any[], filter?: any): any[] {
  if (!filter || !filter.must || !Array.isArray(filter.must) || filter.must.length === 0) {
    return points;
  }
  return points.filter((p: any) => {
    return filter.must.every((cond: any) => {
      if (!p.payload || p.payload[cond.key] === undefined) return false;
      const payloadVal = p.payload[cond.key];
      if (Array.isArray(payloadVal)) {
        return payloadVal.includes(cond.match.value);
      }
      return payloadVal === cond.match.value;
    });
  });
}

export default class AWSVectorDB implements VectorDBClass {
  private client: S3VectorsClient | null;

  constructor() {
    this.client = hasAwsCredentials()
      ? new S3VectorsClient({ region: AWS_REGION, credentials: getAwsCredentials() })
      : null;
  }

  public getCollections = async (): Promise<string[]> => {
    if (!this.client || !awsS3VectorBucket) return [];
    try {
      const response = await this.client.send(new ListIndexesCommand({ vectorBucketName: awsS3VectorBucket }));
      const indexes = response.indexes || [];
      return indexes.map((index) => index.indexName ? convertIndexNameToWhisplay(index.indexName) : "").filter((index) => index !== "");
    } catch (error) {
      console.error("Error listing S3 Vector indexes:", error);
      return [];
    }
  };

  public getCollection = async (collectionName: string): Promise<any> => {
    if (!this.client || !awsS3VectorBucket) return { name: collectionName };

    try {
      const response = await this.client.send(new GetIndexCommand({
        vectorBucketName: awsS3VectorBucket,
        indexName: convertIndexNameFromWhisplay(collectionName),
      }));

      return {
        name: convertIndexNameToWhisplay(collectionName),
        config: {
          params: {
            vectors: {
              size: response.index?.dimension
            }
          }
        }
      };
    } catch (err) {
      console.warn(`Failed to get collection info for ${collectionName}:`, err);
      return { name: collectionName };
    }
  };

  public createCollection = async (
    collectionName: string,
    vectorSize: number,
    distance: "Cosine" | "Dot" | "Euclid"
  ) => {
    if (!this.client || !awsS3VectorBucket) return;
    console.log("Create S3 Vector index:", collectionName);
    let distanceMetric: DistanceMetric = "cosine";
    if (distance === "Cosine") {
      distanceMetric = "cosine";
    } else if (distance === "Euclid") {
      distanceMetric = "euclidean";
    } else {
      console.error("Unsupported distance metric:", distance);
    }
    try {
      await this.client.send(new CreateIndexCommand({
        vectorBucketName: awsS3VectorBucket,
        indexName: convertIndexNameFromWhisplay(collectionName),
        dataType: "float32",
        dimension: vectorSize,
        distanceMetric
      }));
    } catch (error: any) {
      if (error.name !== "ResourceInUseException" && error.name !== "ConflictException") {
        console.warn("Error creating S3 Vector index:", error.message);
      }
    }
  };

  public async deleteCollection(collectionName: string): Promise<void> {
    if (!this.client || !awsS3VectorBucket) return;
    console.log("Delete S3 Vector index:", collectionName);
    try {
      await this.client.send(new DeleteIndexCommand({
        vectorBucketName: awsS3VectorBucket,
        indexName: convertIndexNameFromWhisplay(collectionName),
      }));
    } catch (err) {
      console.error("Failed to delete S3 Vector index", err);
    }
  }

  public upsertPoints = async (
    collectionName: string,
    points: Array<{
      id: number | string;
      vector: number[];
      payload?: Record<string, any>;
    }>
  ) => {
    if (!this.client || !awsS3VectorBucket) return;

    const vectors: PutInputVector[] = points.map(p => ({
      key: String(p.id),
      data: {
        float32: p.vector
      },
      metadata: p.payload
    } as PutInputVector));

    try {
      await this.client.send(new PutVectorsCommand({
        vectorBucketName: awsS3VectorBucket,
        indexName: convertIndexNameFromWhisplay(collectionName),
        vectors
      }));
    } catch (err) {
      console.error(`Failed to upsert points to S3 Vector in ${collectionName}`, err);
    }
  };

  public search = async (
    collectionName: string,
    queryVector: number[],
    limit: number,
    filter?: any
  ) => {
    if (!this.client || !awsS3VectorBucket) return [];

    let s3Filter = convertFilter(filter);

    try {
      const response = await this.client.send(new QueryVectorsCommand({
        vectorBucketName: awsS3VectorBucket,
        indexName: convertIndexNameFromWhisplay(collectionName),
        queryVector: {
          float32: queryVector
        },
        topK: limit,
        filter: s3Filter,
        returnDistance: true,
        returnMetadata: true,
      }));
      const matches = response.vectors || [];

      return matches.map((m) => ({
        id: m.key,
        score: m.distance,
        payload: m.metadata,
        vector: null
      }));
    } catch (err) {
      console.error(`Failed to search points in S3 Vector ${collectionName}`, err);
      return [];
    }
  };

  public retrieve = async (
    collectionName: string,
    ids: Array<number | string>
  ) => {
    if (!this.client || !awsS3VectorBucket) return [];

    try {
      const response = await this.client.send(new GetVectorsCommand({
        vectorBucketName: awsS3VectorBucket,
        indexName: convertIndexNameFromWhisplay(collectionName),
        keys: ids.map(String),
        returnMetadata: true,
        returnData: true
      }));
      const matches = response.vectors || [];

      return matches.map((m) => ({
        id: m.key,
        score: null,
        payload: m.metadata,
        vector: m?.data?.float32 || null
      }));
    } catch (err) {
      console.error(`Failed to retrieve points from S3 Vector ${collectionName}`, err);
      return [];
    }
  };

  public scroll = async (
    collectionName: string,
    limit: number,
    filter?: any,
    offset?: number | string | null,
    withPayload: boolean = true
  ) => {
    if (!this.client || !awsS3VectorBucket) return { points: [], next_page_offset: null };

    const requiresMetadata = withPayload || !!filter;

    try {
      const response = await this.client.send(new ListVectorsCommand({
        vectorBucketName: awsS3VectorBucket,
        indexName: convertIndexNameFromWhisplay(collectionName),
        maxResults: limit,
        nextToken: typeof offset === "string" ? offset : undefined,
        returnData: false,
        returnMetadata: requiresMetadata,
      }));

      let points = (response.vectors || []).map((m: any) => ({
        id: m.key,
        payload: m.metadata || null,
        vector: m.data?.float32 || null
      }));

      if (filter) {
        points = applyLocalFilter(points, filter);
      }

      if (!withPayload) {
        points = points.map(p => ({ ...p, payload: null }));
      }

      return {
        points,
        next_page_offset: response.nextToken || null
      };
    } catch (err) {
      console.error(`Failed to scroll points from S3 Vector ${collectionName}`, err);
      return { points: [], next_page_offset: null };
    }
  };

  public deletePointsByFilter = async (
    collectionName: string,
    filter: any
  ): Promise<void> => {
    if (!this.client || !awsS3VectorBucket || !filter) return;

    let nextToken: string | undefined = undefined;
    const keysToDelete: string[] = [];

    try {
      do {
        const response: any = await this.client.send(new ListVectorsCommand({
          vectorBucketName: awsS3VectorBucket,
          indexName: convertIndexNameFromWhisplay(collectionName),
          maxResults: 1000,
          nextToken: nextToken,
          returnData: false,
          returnMetadata: true,
        }));

        const originalPoints = (response.vectors || []).map((m: any) => ({
          id: m.key,
          payload: m.metadata || null,
          vector: m.data?.float32 || null
        }));

        const matchedPoints = applyLocalFilter(originalPoints, filter);
        for (const p of matchedPoints) {
          keysToDelete.push(String(p.id));
        }

        nextToken = response.nextToken;
      } while (nextToken);

      if (keysToDelete.length > 0) {
        for (let i = 0; i < keysToDelete.length; i += 500) {
          const chunk = keysToDelete.slice(i, i + 500);
          await this.client.send(new DeleteVectorsCommand({
            vectorBucketName: awsS3VectorBucket,
            indexName: convertIndexNameFromWhisplay(collectionName),
            keys: chunk
          }));
        }
      }
    } catch (err) {
      console.error(`Failed to delete points by filter from S3 Vector ${collectionName}`, err);
    }
  };
}
