/** API Serverが開発用リセットで利用するConversation Coordinator RPC境界。 */
export interface ConversationCoordinatorRpc {
  getResetEpoch(accountId: string): Promise<number>;
  resetAccountData(accountId: string): Promise<number>;
}

export interface ConversationCoordinatorNamespace {
  getByName(name: string): ConversationCoordinatorRpc;
}

export function conversationCoordinatorFor(
  namespace: ConversationCoordinatorNamespace,
  accountId: string,
): ConversationCoordinatorRpc {
  return namespace.getByName(accountId);
}
