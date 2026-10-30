alter table public.sponsor_brand_kit_files
  add column if not exists label text;

update public.sponsor_brand_kit_files
set label = left(coalesce(nullif(btrim(file_name), ''), 'Datei'), 100)
where label is null or btrim(label) = '';

alter table public.sponsor_brand_kit_files
  alter column label set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.sponsor_brand_kit_files'::regclass
      and conname = 'sponsor_brand_kit_files_label_check'
  ) then
    alter table public.sponsor_brand_kit_files
      add constraint sponsor_brand_kit_files_label_check
      check (length(trim(label)) between 1 and 100);
  end if;
end;
$$;
