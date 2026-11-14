/** IPC channels for the operator state file: main owns the file, the cluster frame asks for it. */
export const STATE_CHANNELS = {
  read: "read-state",
  write: "write-state",
} as const;
