import { Renderer } from "@freelensapp/extensions";

import type { RedisCRD, RedisSpec, RedisStatus } from "./types";

const GROUP = "redis.redis.opstreelabs.in/v1beta2";

type Metadata = Renderer.K8sApi.KubeObjectMetadata;

export class RedisStandalone extends Renderer.K8sApi.LensExtensionKubeObject<
  Metadata,
  RedisStatus,
  RedisSpec
> {
  static override readonly kind = "Redis";
  static override readonly namespaced = true;
  static override readonly apiBase = `/apis/${GROUP}/redis`;
  static override readonly crd: RedisCRD = {
    apiVersions: [GROUP],
    plural: "redis",
    singular: "redis",
    title: "Redis",
  };
}

export class RedisReplication extends Renderer.K8sApi.LensExtensionKubeObject<
  Metadata,
  RedisStatus,
  RedisSpec
> {
  static override readonly kind = "RedisReplication";
  static override readonly namespaced = true;
  static override readonly apiBase = `/apis/${GROUP}/redisreplications`;
  static override readonly crd: RedisCRD = {
    apiVersions: [GROUP],
    plural: "redisreplications",
    singular: "redisreplication",
    title: "Redis replications",
  };
}

export class RedisCluster extends Renderer.K8sApi.LensExtensionKubeObject<
  Metadata,
  RedisStatus,
  RedisSpec
> {
  static override readonly kind = "RedisCluster";
  static override readonly namespaced = true;
  static override readonly apiBase = `/apis/${GROUP}/redisclusters`;
  static override readonly crd: RedisCRD = {
    apiVersions: [GROUP],
    plural: "redisclusters",
    singular: "rediscluster",
    title: "Redis clusters",
  };
}

export class RedisSentinel extends Renderer.K8sApi.LensExtensionKubeObject<
  Metadata,
  RedisStatus,
  RedisSpec
> {
  static override readonly kind = "RedisSentinel";
  static override readonly namespaced = true;
  static override readonly apiBase = `/apis/${GROUP}/redissentinels`;
  static override readonly crd: RedisCRD = {
    apiVersions: [GROUP],
    plural: "redissentinels",
    singular: "redissentinel",
    title: "Redis sentinels",
  };
}
