export type MessageHandler<T = unknown> = (msg: T) => void | Promise<void>;
export type Unsubscribe = () => void;

export class MessageBus {
  private subscribers = new Map<string, Set<MessageHandler>>();

  subscribe<T = unknown>(topic: string, handler: MessageHandler<T>): Unsubscribe {
    let set = this.subscribers.get(topic);
    if (!set) {
      set = new Set();
      this.subscribers.set(topic, set);
    }
    set.add(handler as MessageHandler);
    return () => {
      set?.delete(handler as MessageHandler);
    };
  }

  async publish<T = unknown>(topic: string, msg: T): Promise<void> {
    const set = this.subscribers.get(topic);
    if (!set) return;
    for (const handler of set) {
      try {
        await handler(msg);
      } catch (err) {
        // at-least-once delivery: a broken handler should not block others.
        // eslint-disable-next-line no-console
        console.error(`MessageBus handler for topic ${topic} threw:`, err);
      }
    }
  }
}
