path = '/home/vpo/v42/internal/db/store/backlog.go'
with open(path, 'r') as f:
    content = f.read()

# Fix BacklogItem struct
marker = 'StageID       *string   `json:"stage_id"`'
insert = '\n\tNodeID        *string   `json:"node_id"`'
if marker in content and 'NodeID        *string   `json:"node_id"`' not in content:
    content = content.replace(marker, marker + insert, 1)
    print('Added NodeID to BacklogItem struct')
else:
    print('BacklogItem: already patched or marker not found')

# Fix UpdateBacklogItemRequest struct
marker2 = 'StageID       *string\n\tAcSetup'
insert2 = 'StageID       *string\n\tNodeID        *string\n\tAcSetup'
if marker2 in content and 'NodeID        *string\n\tAcSetup' not in content:
    content = content.replace(marker2, insert2, 1)
    print('Added NodeID to UpdateBacklogItemRequest')
else:
    print('UpdateBacklogItemRequest: already patched or marker not found')

with open(path, 'w') as f:
    f.write(content)

print('Done')
