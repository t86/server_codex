alter table threads alter column model set default 'gpt-5.5';

update threads
set model = 'gpt-5.5',
    updated_at = now()
where model = 'codex-cli';
