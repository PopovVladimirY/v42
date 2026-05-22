-- Seed builtin skill catalog: the classics, not a holy war.
-- Custom skills can be added via POST /api/v1/skills by admins.
INSERT INTO skills (name, category, is_builtin) VALUES
    -- Backend
    ('Go',          'Backend',  true),
    ('Python',      'Backend',  true),
    ('Java',        'Backend',  true),
    ('Rust',        'Backend',  true),
    ('Node.js',     'Backend',  true),
    ('C#',          'Backend',  true),
    ('C++',         'Backend',  true),
    -- Frontend
    ('TypeScript',  'Frontend', true),
    ('JavaScript',  'Frontend', true),
    ('React',       'Frontend', true),
    ('Vue.js',      'Frontend', true),
    ('CSS',         'Frontend', true),
    -- Data / AI
    ('SQL',         'Data',     true),
    ('PostgreSQL',  'Data',     true),
    ('Redis',       'Data',     true),
    ('Elasticsearch','Data',    true),
    ('Python ML',   'Data',     true),
    -- Infrastructure
    ('Docker',      'DevOps',   true),
    ('Kubernetes',  'DevOps',   true),
    ('Terraform',   'DevOps',   true),
    ('Linux',       'DevOps',   true),
    ('AWS',         'DevOps',   true),
    -- Quality
    ('QA Manual',   'QA',       true),
    ('QA Automation','QA',      true),
    ('Playwright',  'QA',       true),
    -- Design
    ('UI/UX Design','Design',   true),
    ('Figma',       'Design',   true),
    -- General
    ('Technical Writing', 'General', true),
    ('Agile/Scrum', 'General',  true),
    ('Architecture','General',  true)
ON CONFLICT (name) DO NOTHING;
