import { reasonOf } from "./errors";
import type { MetricData } from "./types";

/** One read per key at a time: a tick while it is pending asks nothing, so answers land in order. */
export class ReadGate {
  private readonly pending = new Set<string>();

  /** Undefined, without calling `read`, while the same key is being read. */
  run<T>(key: string, read: () => Promise<T>): Promise<T> | undefined {
    if (this.pending.has(key)) return undefined;

    this.pending.add(key);

    return (async () => read())().finally(() => this.pending.delete(key));
  }
}

/** One read per key at a time: asking again while it is pending joins it, so no answer is lost. */
export class JoinedReads<T> {
  private readonly pending = new Map<string, Promise<T>>();

  join(key: string, read: () => Promise<T>): Promise<T> {
    const known = this.pending.get(key);

    if (known) return known;

    const started = (async () => read())().finally(() => this.pending.delete(key));

    this.pending.set(key, started);

    return started;
  }
}

/** The last answer per source, shared by every page; each answer is told to every page shown. */
export class SharedReads<Answer> {
  private readonly answers = new Map<string, Answer>();
  private readonly gate = new ReadGate();
  private readonly listeners = new Set<() => void>();

  get(key: string): Answer | undefined {
    return this.answers.get(key);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Nothing while `key` is still being read; `read` must not reject. */
  ask(key: string, read: () => Promise<Answer>): void {
    void this.gate.run(key, read)?.then((answer) => {
      this.answers.set(key, answer);
      for (const listener of this.listeners) listener();
    });
  }
}

// One query at a time, since a batch fails as a whole; a failure keeps its error and reads as no data.
export async function askInTurn<Key extends string>(
  queries: Record<Key, string>,
  ask: (query: string) => Promise<MetricData>,
  stopped: () => boolean = () => false,
): Promise<Partial<Record<Key, MetricData>>> {
  const answers: Partial<Record<Key, MetricData>> = {};

  for (const [key, query] of Object.entries(queries) as [Key, string][]) {
    if (stopped()) break;

    try {
      answers[key] = await ask(query);
    } catch (error) {
      answers[key] = { status: "error", error: reasonOf(error) };
    }
  }

  return answers;
}

export type LiveState = "reading" | "read";

/** The sources one kind of read asked, and the answers on hand. */
export interface Asked {
  asked: string[];
  answers: { source: string }[];
}

/** "read" once the stores are loaded, each source asked has answered and the Events are read. */
export function liveState({
  loading,
  reads,
  eventsWanted,
  eventsRead,
}: {
  loading: boolean;
  /** One per kind of read: the same source answers each kind on its own. */
  reads: Asked[];
  /** The namespaces whose Events are wanted, joined; "" for none. */
  eventsWanted: string;
  /** The namespaces the Events on hand were read for. */
  eventsRead: string | undefined;
}): LiveState {
  const answered = ({ asked, answers }: Asked) => {
    const sources = new Set(answers.map((each) => each.source));

    return asked.every((source) => sources.has(source));
  };
  const eventsSettled = !eventsWanted || eventsRead === eventsWanted;

  return !loading && eventsSettled && reads.every(answered) ? "read" : "reading";
}
