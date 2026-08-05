export type E2eCase = {
  id: string;
  name: string;
  in: {
    method: string;
    path: string;
    authorization: string | null;
    setup?: readonly string[];
  };
  out: {
    status: number;
    body: Readonly<Record<string, unknown>>;
  };
};
