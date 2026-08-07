import m0000 from "./0000_shallow_bushwacker.sql";
import m0001 from "./0001_graceful_tusk.sql";
import m0002 from "./0002_lumpy_morlocks.sql";
import journal from "./meta/_journal.json";

export default {
  journal,
  migrations: {
    m0000,
    m0001,
    m0002,
  },
};
