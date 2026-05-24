path = '/home/vpo/v42/internal/api/handler_backlog.go'
with open(path, 'r', newline='') as f:
    content = f.read()

# The broken line has tabs between StageID, NodeID, and Title fields
# Fix 1: split the merged struct fields in the Update handler
bad = '\t\tStageID       *string `json:"stage_id"`\t\t\tNodeID        *string `json:"node_id"`\t\tTitle         *string `json:"title"`'
good = '\t\tStageID       *string `json:"stage_id"`\r\n\t\tNodeID        *string `json:"node_id"`\r\n\t\tTitle         *string `json:"title"`'

if bad in content:
    content = content.replace(bad, good, 1)
    print('Fixed Update handler struct')
else:
    # Try without \r\n, maybe LF only
    bad2 = bad.replace('\r\n', '\n')
    good2 = good.replace('\r\n', '\n')
    if bad2 in content:
        content = content.replace(bad2, good2, 1)
        print('Fixed Update handler struct (LF)')
    else:
        print('NOT FOUND, searching...')
        idx = content.find('StageID       *string')
        if idx >= 0:
            print(repr(content[idx:idx+200]))

with open(path, 'w', newline='') as f:
    f.write(content)

print('Done')
