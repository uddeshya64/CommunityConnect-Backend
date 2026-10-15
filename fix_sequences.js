const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function fixAllSequences() {
  // Query all sequence names and their associated table / column
  const sequences = await prisma.$queryRawUnsafe(`
    SELECT 
      c.relname as sequence_name,
      t.relname as table_name,
      a.attname as column_name
    FROM pg_class c
    JOIN pg_depend d ON d.objid = c.oid
    JOIN pg_class t ON t.oid = d.refobjid
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
    WHERE c.relkind = 'S'
  `);

  console.log(`Found ${sequences.length} sequences to check/fix.`);

  for (const seq of sequences) {
    const { sequence_name, table_name, column_name } = seq;
    try {
      const maxRes = await prisma.$queryRawUnsafe(`SELECT MAX("${column_name}") as max_val FROM "${table_name}"`);
      const maxVal = maxRes[0]?.max_val;
      const seqRes = await prisma.$queryRawUnsafe(`SELECT last_value FROM "${sequence_name}"`);
      const lastVal = seqRes[0]?.last_value;

      if (maxVal !== null && maxVal !== undefined) {
        console.log(`Table: ${table_name}.${column_name} | Max: ${maxVal} | Seq ${sequence_name}: ${lastVal}`);
        if (BigInt(maxVal) >= BigInt(lastVal)) {
          const nextVal = BigInt(maxVal) + 1n;
          await prisma.$queryRawUnsafe(`SELECT setval('${sequence_name}', ${maxVal}, true)`);
          console.log(`  -> FIXED sequence ${sequence_name} to ${maxVal}`);
        }
      }
    } catch (err) {
      console.error(`Error checking/fixing ${sequence_name} on ${table_name}:`, err.message);
    }
  }
}

fixAllSequences()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
