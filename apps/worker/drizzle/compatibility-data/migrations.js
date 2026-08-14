import m0000 from "./0000_lively_marvex.sql";
import m0001 from "./0001_yummy_radioactive_man.sql";
import m0002 from "./0002_funny_dreadnoughts.sql";
import journal from "./meta/_journal.json";

export default {
  journal,
  migrations: {
    m0000,
    m0001,
    m0002,
  },
};
