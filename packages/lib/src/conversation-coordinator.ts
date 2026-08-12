/** API Serverが開発用リセットで利用するConversation Coordinator RPC境界。 */
export interface ConversationCoordinatorRpc {
  resetAccountData(accountId: string): Promise<void>;
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
