import { Renderer } from "@freelensapp/extensions";

import type { MongoCRD, ReplicaSetSpec, ReplicaSetStatus } from "./types";

const COMMUNITY = "mongodbcommunity.mongodb.com/v1";

export class MongoDBCommunity extends Renderer.K8sApi.LensExtensionKubeObject<
  Renderer.K8sApi.KubeObjectMetadata,
  ReplicaSetStatus,
  ReplicaSetSpec
> {
  static override readonly kind = "MongoDBCommunity";
  static override readonly namespaced = true;
  static override readonly apiBase = `/apis/${COMMUNITY}/mongodbcommunity`;

  static override readonly crd: MongoCRD = {
    apiVersions: [COMMUNITY],
    plural: "mongodbcommunity",
    singular: "mongodbcommunity",
    shortNames: ["mdbc"],
    title: "MongoDB clusters",
  };
}
