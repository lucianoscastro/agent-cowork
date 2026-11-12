import { useT } from '../i18n';
import { Embedded } from '../ui';
import { Integrations } from './Integrations';
import { Providers } from './Providers';

/** Every account the instance uses, in one place: GitHub and Jira, then the agent runtimes. */
export function Accounts() {
  const t = useT();
  return (
    <>
      <h1>{t('Accounts')}</h1>
      <p className="lead">{t('The accounts the agents act as. Credentials are stored encrypted and never shown again; the agents never see the GitHub or Jira ones.')}</p>
      <Embedded.Provider value>
        <Integrations />
        <Providers />
      </Embedded.Provider>
    </>
  );
}
