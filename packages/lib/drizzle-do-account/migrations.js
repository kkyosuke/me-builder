import m0000 from "./0000_baseline.sql";
import m0001 from "./0001_broken_tyger_tiger.sql";
import journal from "./meta/_journal.json";

export default {
  journal,
  migrations: {
    m0000,
    m0001,
  },
};
