-- CORREÇÃO DO ERRO 42702: coluna "name" ambígua
-- Execute este arquivo se o setup anterior parou na policy do Storage.

drop policy if exists "storage protected read" on storage.objects;

create policy "storage protected read"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'materials'
  and (
    public.is_admin()
    or exists (
      select 1
      from public.materials m
      join public.subjects s
        on s.id = m.subject_id
      join public.contest_disciplines d
        on d.id = s.contest_discipline_id
      where m.storage_path = storage.objects.name
        and public.has_contest_access(d.contest_id)
    )
  )
);
