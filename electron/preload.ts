import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("miku", {
  send(channel: string, ...args: unknown[]) {
    ipcRenderer.send(channel, ...args);
  },
  invoke(channel: string, ...args: unknown[]) {
    return ipcRenderer.invoke(channel, ...args);
  },
  on(channel: string, handler: (...args: unknown[]) => void) {
    const wrapped = (_evt: unknown, ...args: unknown[]) => handler(...args);
    ipcRenderer.on(channel, wrapped);
    return () => {
      ipcRenderer.removeListener(channel, wrapped);
    };
  },
});
