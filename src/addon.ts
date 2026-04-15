import { config } from "../package.json";
import * as hooks from "./hooks";

/**
 * Addon data class for Zotero FileRenamer.
 */
class Addon {
  public data: {
    alive: boolean;
    config: typeof config;
    ztoolkit: any;
    dialog?: any;
  };
  public hooks: typeof hooks;

  constructor() {
    this.data = {
      alive: true,
      config,
      ztoolkit: undefined,
      dialog: undefined,
    };
    this.hooks = hooks;
  }
}

export default Addon;
