import { useState } from 'react';
import { useT } from '../i18n';
import { Card, PAGE_SIZE, PageHeader, Pager, Time, useFetch } from '../ui';

export function Activity() {
  const t = useT();
  const [page, setPage] = useState(0);
  const { data } = useFetch<{ at: string; actor: string; action: string; detail: string }[]>(
    `/activity?limit=${PAGE_SIZE + 1}&offset=${page * PAGE_SIZE}`,
    15_000,
  );
  const audit = data?.slice(0, PAGE_SIZE);
  const { data: logs } = useFetch<string[]>('/logs', 5000);
  return (
    <>
      <PageHeader title="Activity & logs" />
      <Card title="Audit log">
        <table>
          <thead>
            <tr>
              <th>{t('When')}</th>
              <th>{t('Who')}</th>
              <th>{t('Action')}</th>
              <th>{t('Detail')}</th>
            </tr>
          </thead>
          <tbody>
            {(audit ?? []).map((a, i) => (
              <tr key={i}>
                <td>
                  <Time iso={a.at} />
                </td>
                <td>{a.actor}</td>
                <td>
                  <code>{a.action}</code>
                </td>
                <td className="clip">{a.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pager page={page} hasNext={(data?.length ?? 0) > PAGE_SIZE} onPage={setPage} />
      </Card>
      <Card title="Recent logs">
        <pre className="log">{(logs ?? []).join('\n')}</pre>
      </Card>
    </>
  );
}
