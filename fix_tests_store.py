"""Fix NullTestType / NullTestRunStatus in tests store."""
import re

path = '/home/vpo/v42/internal/db/store/tests.go'
with open(path, 'r') as f:
    content = f.read()

# Fix 1: &t (type *TestType) -> NullTestType struct
old1 = (
    'if testType != nil {\n'
    '\t\tt := dbgen.TestType(*testType)\n'
    '\t\targ.Type = &t\n'
    '\t}'
)
new1 = (
    'if testType != nil {\n'
    '\t\targ.Type = dbgen.NullTestType{TestType: dbgen.TestType(*testType), Valid: true}\n'
    '\t}'
)
if old1 in content:
    content = content.replace(old1, new1, 1)
    print('fixed TestType assignment')
else:
    print('WARNING: TestType assignment not found')

# Fix 2: r.TestType != nil -> r.TestType.Valid
old2 = (
    'if r.TestType != nil {\n'
    '\t\t\t\tv := string(*r.TestType)\n'
    '\t\t\t\trow.TestType = &v\n'
    '\t\t\t}'
)
new2 = (
    'if r.TestType.Valid {\n'
    '\t\t\t\tv := string(r.TestType.TestType)\n'
    '\t\t\t\trow.TestType = &v\n'
    '\t\t\t}'
)
if old2 in content:
    content = content.replace(old2, new2, 1)
    print('fixed TestType nil check')
else:
    print('WARNING: TestType nil check not found')

# Fix 3: *TestRunStatus -> NullTestRunStatus
old3 = (
    'if status != "" {\n'
    '\t\tst := dbgen.TestRunStatus(status)\n'
    '\t\targ.Status = &st\n'
    '\t}'
)
new3 = (
    'if status != "" {\n'
    '\t\targ.Status = dbgen.NullTestRunStatus{TestRunStatus: dbgen.TestRunStatus(status), Valid: true}\n'
    '\t}'
)
if old3 in content:
    content = content.replace(old3, new3, 1)
    print('fixed TestRunStatus')
else:
    print('WARNING: TestRunStatus not found')

with open(path, 'w') as f:
    f.write(content)
print('done')
