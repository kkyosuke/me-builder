export type E2eCase = {
  id: string;
  name: string;
  in: {
    method: string;
    path: string;
    authorization: string | null;
    body?: Readonly<Record<string, unknown>>;
    setup?: readonly string[];
  };
  out: {
    status: number;
    body: Readonly<Record<string, unknown>>;
  };
};
