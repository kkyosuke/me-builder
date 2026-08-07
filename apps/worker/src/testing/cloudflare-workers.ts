/** Node上の単体テストでWorker entrypointをimportするためだけの最小shim。 */
export abstract class DurableObject<Env> {
  protected ctx: DurableObjectState;
  protected env: Env;

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}
