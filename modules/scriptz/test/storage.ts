import { getKvStore, setKvStore, type KvStore } from "@agentz/kit/platform";
import { getStorageAdapter, setStorageAdapter, type ScriptzStorage } from "../lib/storage";

/** Test fixtures can describe both stores together while production contracts
 * remain independent. Installation always registers each contract explicitly. */
export type TestStorage = ScriptzStorage & KvStore;

export function setTestStorage(storage: TestStorage): void {
  setStorageAdapter(storage);
  setKvStore(storage);
}

export function getTestStorage(): TestStorage {
  const product = getStorageAdapter();
  const kv = getKvStore();
  const methods = {
    getSetting: kv.getSetting.bind(kv),
    setSetting: kv.setSetting.bind(kv),
    getAppState: kv.getAppState.bind(kv),
    setAppState: kv.setAppState.bind(kv),
  };
  return new Proxy(product as TestStorage, {
    get(target, key) {
      if (Object.hasOwn(methods, key)) return methods[key as keyof KvStore];
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
