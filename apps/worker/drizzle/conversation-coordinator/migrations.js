import m0000 from "./0000_romantic_kronos.sql";
import m0001 from "./0001_early_randall_flagg.sql";
import m0002 from "./0002_silly_edwin_jarvis.sql";
import journal from "./meta/_journal.json";

export default {
  journal,
  migrations: {
    m0000,
    m0001,
    m0002,
  },
};
