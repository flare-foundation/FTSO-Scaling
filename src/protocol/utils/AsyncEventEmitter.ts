/**
 * Provides similar functionality to Node's {@link EventEmitter}, but with async/await support.
 * The built-in EventEmitter fires listeners synchronously, but in the async case the listeners
 * end up being executed "in parallel", since they're not awaited.
 */
export default abstract class AsyncEventEmitter {
  private listeners: { [key: string]: Function[] } = {};

  on(event: string, listener: Function) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(listener);
  }

  async emit(event: string, ...args: any[]) {
    if (!this.listeners[event]) return;
    for (const listener of this.listeners[event]) {
      await listener(...args);
    }
  }

  removeListener(event: string, listener: Function) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter(l => l !== listener);
  }

  removeAllListeners(event: string) {
    delete this.listeners[event];
  }

  off(event: string, listener: Function) {
    this.removeListener(event, listener);
  }

  once(event: string, listener: Function) {
    const wrappedListener = async (...args: any[]) => {
      await listener(...args);
      this.removeListener(event, wrappedListener);
    };
    this.on(event, wrappedListener);
  }
}
