import m0000 from "./0000_baseline.sql";
import m0001 from "./0001_broken_tyger_tiger.sql";
import m0002 from "./0002_wealthy_titanium_man.sql";
import m0003 from "./0003_conscious_sheva_callister.sql";
import journal from "./meta/_journal.json";

export default {
  journal,
  migrations: {
    m0000,
    m0001,
    m0002,
    m0003,
  },
};
