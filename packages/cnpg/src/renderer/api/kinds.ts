import { Renderer } from "@freelensapp/extensions";

import type {
  BackupSpec,
  BackupStatus,
  ClusterSpec,
  ClusterStatus,
  CnpgCRD,
  ObjectStoreSpec,
  ObjectStoreStatus,
  PoolerSpec,
  PoolerStatus,
  PublicationLike,
  ScheduledBackupSpec,
  ScheduledBackupStatus,
  SubscriptionLike,
} from "./types";

const CNPG = "postgresql.cnpg.io/v1";
const BARMAN = "barmancloud.cnpg.io/v1";

type Metadata = Renderer.K8sApi.KubeObjectMetadata;

export class Cluster extends Renderer.K8sApi.LensExtensionKubeObject<
  Metadata,
  ClusterStatus,
  ClusterSpec
> {
  static override readonly kind = "Cluster";
  static override readonly namespaced = true;
  static override readonly apiBase = `/apis/${CNPG}/clusters`;

  static override readonly crd: CnpgCRD = {
    apiVersions: [CNPG],
    plural: "clusters",
    singular: "cluster",
    title: "Clusters",
  };
}

export class Backup extends Renderer.K8sApi.LensExtensionKubeObject<
  Metadata,
  BackupStatus,
  BackupSpec
> {
  static override readonly kind = "Backup";
  static override readonly namespaced = true;
  static override readonly apiBase = `/apis/${CNPG}/backups`;

  static override readonly crd: CnpgCRD = {
    apiVersions: [CNPG],
    plural: "backups",
    singular: "backup",
    title: "Backups",
  };
}

export class ScheduledBackup extends Renderer.K8sApi.LensExtensionKubeObject<
  Metadata,
  ScheduledBackupStatus,
  ScheduledBackupSpec
> {
  static override readonly kind = "ScheduledBackup";
  static override readonly namespaced = true;
  static override readonly apiBase = `/apis/${CNPG}/scheduledbackups`;

  static override readonly crd: CnpgCRD = {
    apiVersions: [CNPG],
    plural: "scheduledbackups",
    singular: "scheduledbackup",
    title: "Scheduled Backups",
  };
}

export class Pooler extends Renderer.K8sApi.LensExtensionKubeObject<
  Metadata,
  PoolerStatus,
  PoolerSpec
> {
  static override readonly kind = "Pooler";
  static override readonly namespaced = true;
  static override readonly apiBase = `/apis/${CNPG}/poolers`;

  static override readonly crd: CnpgCRD = {
    apiVersions: [CNPG],
    plural: "poolers",
    singular: "pooler",
    title: "Poolers",
  };
}

// The Barman Cloud plugin's kind; absent when backups go elsewhere.
export class ObjectStore extends Renderer.K8sApi.LensExtensionKubeObject<
  Metadata,
  ObjectStoreStatus,
  ObjectStoreSpec
> {
  static override readonly kind = "ObjectStore";
  static override readonly namespaced = true;
  static override readonly apiBase = `/apis/${BARMAN}/objectstores`;

  static override readonly crd: CnpgCRD = {
    apiVersions: [BARMAN],
    plural: "objectstores",
    singular: "objectstore",
    title: "Object Stores",
  };
}

export class Publication extends Renderer.K8sApi.LensExtensionKubeObject<
  Metadata,
  PublicationLike["status"],
  PublicationLike["spec"]
> {
  static override readonly kind = "Publication";
  static override readonly namespaced = true;
  static override readonly apiBase = `/apis/${CNPG}/publications`;

  static override readonly crd: CnpgCRD = {
    apiVersions: [CNPG],
    plural: "publications",
    singular: "publication",
    title: "Publications",
  };
}

export class Subscription extends Renderer.K8sApi.LensExtensionKubeObject<
  Metadata,
  SubscriptionLike["status"],
  SubscriptionLike["spec"]
> {
  static override readonly kind = "Subscription";
  static override readonly namespaced = true;
  static override readonly apiBase = `/apis/${CNPG}/subscriptions`;

  static override readonly crd: CnpgCRD = {
    apiVersions: [CNPG],
    plural: "subscriptions",
    singular: "subscription",
    title: "Subscriptions",
  };
}
