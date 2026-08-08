import { d1 } from "@me-builder/lib";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { AccountDataRepository } from "./repository";

function createRepository() {
  const sqlite = new Database(":memory:");
  const sql = {
    exec<T>(query: string, ...params: unknown[]) {
      if (params.length === 0 && query.includes(";")) {
        sqlite.exec(query);
        return { toArray: () => [] as T[], one: () => undefined as T };
      }
      const statement = sqlite.prepare(query);
      const rows = statement.reader ? (statement.all(...params) as T[]) : [];
      const rawRows = statement.reader ? (statement.raw(true).all(...params) as unknown[][]) : [];
      if (!statement.reader) statement.run(...params);
      return {
        toArray: () => rows,
        raw: () => ({ toArray: () => rawRows }),
        one: () => {
          const row = rows[0];
          if (!row) throw new Error("Expected one row");
          return row;
        },
      };
    },
  };
  const storage = {
    sql,
    transactionSync: <T>(callback: () => T) => sqlite.transaction(callback)(),
  } as unknown as DurableObjectStorage;
  return new AccountDataRepository(storage);
}

describe("AccountDataRepository", () => {
  it("Objectを最初のAccountへ固定し、異なるAccountを拒否する", async () => {
    const repository = createRepository();
    await repository.initialize();
    repository.bindAccount("account-1");

    expect(() => repository.bindAccount("account-2")).toThrow(
      "AccountData Object cannot be used by another account",
    );
  });

  it("別ObjectのAccount所有データをSELECTできない", async () => {
    const first = createRepository();
    const second = createRepository();
    await Promise.all([first.initialize(), second.initialize()]);
    first.bindAccount("account-1");
    second.bindAccount("account-2");

    const source = await d1.action.conversation.storeLineTextSource(first.client, {
      accountId: "account-1",
      eventId: "event-1",
      body: "private diary",
      receivedAt: new Date("2026-08-08T00:00:00.000Z"),
    });

    expect(await second.client.select().from(d1.schema.sourceRecords).all()).toEqual([]);
    expect(
      await second.client
        .select()
        .from(d1.schema.sourceRecordTextPayloads)
        // IDを知っていても別Objectには行そのものがない。
        .where(eq(d1.schema.sourceRecordTextPayloads.sourceRecordId, source.sourceRecordId))
        .get(),
    ).toBeUndefined();
  });

  it("Diagnosis回答・Source・projection requestを同じAccount SQLiteへ保存する", async () => {
    const repository = createRepository();
    await repository.initialize();
    repository.bindAccount("account-1");
    const at = new Date("2026-08-08T00:00:00.000Z");
    const lifecycle = { createdAt: at, updatedAt: at, deletedAt: null, isDeleted: false };
    repository.syncDiagnosisCatalog({
      questions: [{ id: "question-1", ...lifecycle }],
      questionVersions: [
        {
          questionId: "question-1",
          version: 1,
          state: "approved",
          text: "Question",
          hint: null,
          format: "single_choice",
          approvedAt: at,
          retiredAt: null,
          ...lifecycle,
        },
      ],
      questionChoices: [
        {
          questionId: "question-1",
          questionVersion: 1,
          choiceId: "yes",
          label: "Yes",
          position: 1,
          presentation: null,
          ...lifecycle,
        },
      ],
      scoringConfigs: [],
      diagnoses: [
        {
          id: "diagnosis-1",
          title: "Diagnosis",
          description: "Description",
          scoringConfigId: null,
          displayOrder: 1,
          opensAt: new Date("2026-08-01T00:00:00.000Z"),
          closesAt: null,
          state: "published",
          publishedAt: at,
          withdrawnAt: null,
          ...lifecycle,
        },
      ],
      diagnosisQuestions: [
        {
          id: "diagnosis-question-1",
          diagnosisId: "diagnosis-1",
          questionId: "question-1",
          questionVersion: 1,
          position: 1,
          ...lifecycle,
        },
      ],
    });

    const saved = await d1.action.diagnosis.saveDiagnosisAnswer(repository.client, {
      accountId: "account-1",
      diagnosisId: "diagnosis-1",
      diagnosisQuestionId: "diagnosis-question-1",
      choiceId: "yes",
      at,
    });

    expect(saved).toMatchObject({ type: "saved", progress: { responseStatus: "answered" } });
    expect(await repository.client.select().from(d1.schema.sourceRecords).all()).toHaveLength(1);
    expect(
      await repository.client.select().from(d1.schema.diagnosisBrainProjectionRequests).all(),
    ).toHaveLength(1);
  });
});
