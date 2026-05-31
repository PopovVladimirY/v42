-- Global sequential numbers for tasks (Z-NNNN) and tests (T-NNNN).
-- Uses PostgreSQL sequences so the counter is atomic and system-wide.

-- tasks.number
CREATE SEQUENCE tasks_number_seq;

ALTER TABLE tasks ADD COLUMN number BIGINT;

-- Backfill existing rows in creation order
UPDATE tasks t
SET    number = sub.rn
FROM   (
  SELECT id,
         ROW_NUMBER() OVER (ORDER BY created_at, id) AS rn
  FROM   tasks
) sub
WHERE  t.id = sub.id;

-- Advance sequence past backfilled values.
-- Three-arg setval: on an empty table set to 1 with is_called=false so the first
-- nextval() still yields 1 (setval value 0 is illegal -- a sequence floor is 1).
SELECT setval(
  'tasks_number_seq',
  GREATEST(COALESCE((SELECT MAX(number) FROM tasks), 0), 1),
  (SELECT MAX(number) FROM tasks) IS NOT NULL
);

ALTER TABLE tasks
  ALTER COLUMN number SET DEFAULT nextval('tasks_number_seq'),
  ALTER COLUMN number SET NOT NULL;

ALTER SEQUENCE tasks_number_seq OWNED BY tasks.number;

-- tests.number
CREATE SEQUENCE tests_number_seq;

ALTER TABLE tests ADD COLUMN number BIGINT;

UPDATE tests t
SET    number = sub.rn
FROM   (
  SELECT id,
         ROW_NUMBER() OVER (ORDER BY created_at, id) AS rn
  FROM   tests
) sub
WHERE  t.id = sub.id;

SELECT setval(
  'tests_number_seq',
  GREATEST(COALESCE((SELECT MAX(number) FROM tests), 0), 1),
  (SELECT MAX(number) FROM tests) IS NOT NULL
);

ALTER TABLE tests
  ALTER COLUMN number SET DEFAULT nextval('tests_number_seq'),
  ALTER COLUMN number SET NOT NULL;

ALTER SEQUENCE tests_number_seq OWNED BY tests.number;
