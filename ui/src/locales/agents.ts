/** The Agents pages (team grid, one agent's overview and settings). Shape: Translations in i18n.tsx (no import, so the server's tests can load this file as it is). */
const translations = {
  'pt-BR': {
    // Model picker and save row
    'Pick from the list or type any id. Empty uses the provider default.': 'Escolha da lista ou digite qualquer id. Vazio usa o padrão do provedor.',
    Provider: 'Provedor',
    Model: 'Modelo',
    Ready: 'Pronto',
    Save: 'Salvar',
    // Descriptions
    "Picks agent-ready cards from each project's Jira board, plans with the lead, has the reviewer check the plan and the diff, verifies with the repository commands and opens a PR per changed repository. Then it follows each PR until it is merged or closed: it answers every review comment (fixing it, or declining it with a justification) and keeps the pipeline green, including quality gates such as SonarQube. Merging stays with humans.":
      'Pega os cards prontos para o agente no board do Jira de cada projeto, planeja com o lead, faz o revisor checar o plano e o diff, verifica com os comandos do repositório e abre um PR por repositório alterado. Depois acompanha cada PR até o merge ou o fechamento: responde a todo comentário de revisão (corrigindo, ou recusando com uma justificativa) e mantém o pipeline verde, incluindo quality gates como o SonarQube. O merge fica com as pessoas.',
    'Reviews open PRs that request review directly from the GitHub user of this instance. Approves when there is nothing to suggest; otherwise comments inline.':
      'Revisa os PRs abertos que pedem revisão diretamente ao usuário do GitHub desta instância. Aprova quando não há nada a sugerir; caso contrário, comenta inline.',
    "Watches every repository of the projects under Projects. Merges Dependabot PRs when the release is older than the cooldown, checks are green, the repository's verify commands pass and the model finds no risk. Everything else goes to the inbox.":
      'Acompanha todos os repositórios dos projetos em Projetos. Faz o merge dos PRs do Dependabot quando a release é mais antiga que o cooldown, os checks estão verdes, os comandos de verificação do repositório passam e o modelo não vê risco. Todo o resto vai para a caixa de entrada.',
    "Once a day per project with a test environment (Projects → Test environment): runs the project's end-to-end suite (Playwright, Cucumber or Cypress, found in its repositories), runs each failed test again on its own to rule out flakiness, reproduces the ones that keep failing in a browser, and files the real bugs on the project's board with screenshots, the HAR and the steps, or comments on the open bug. Every few hours it also explores what changed in the repositories checked for it, and sends what it confirms to the inbox, where a person turns it into a card.":
      'Uma vez por dia em cada projeto com ambiente de teste (Projetos → Ambiente de teste): roda a suíte end-to-end do projeto (Playwright, Cucumber ou Cypress, encontrada nos seus repositórios), roda de novo cada teste que falhou, isoladamente, para descartar instabilidade, reproduz no navegador os que continuam falhando e registra os bugs reais no board do projeto com screenshots, o HAR e os passos, ou comenta no bug aberto. A cada poucas horas também explora o que mudou nos repositórios marcados para ele e envia o que confirmar para a caixa de entrada, onde uma pessoa o transforma em card.',
    "Audits every repository of the projects under Projects on its base branch, one category at a time, each with its own skill, model and interval, and only when the branch has new commits since that category's last audit. Results go to the Findings page; critical and high findings also go to the inbox. Read-only on the code.":
      'Audita todos os repositórios dos projetos em Projetos na branch base, uma categoria por vez, cada uma com sua própria skill, modelo e intervalo, e só quando a branch tem commits novos desde a última auditoria daquela categoria. Os resultados vão para a página Achados; os achados críticos e altos também vão para a caixa de entrada. Somente leitura no código.',
    'In dry run an agent does all the work (models, verification) but writes nothing to GitHub or Jira; take agents live one at a time. Dry runs keep their own history, so going live does not skip real work.':
      'Em dry run, o agente faz todo o trabalho (modelos, verificação), mas não escreve nada no GitHub nem no Jira; coloque os agentes em produção um de cada vez. Os dry runs têm histórico próprio, então ir para produção não pula trabalho real.',
    // Settings: common
    Enabled: 'Ativado',
    'Dry run (writes nothing to GitHub or Jira)': 'Dry run (não escreve nada no GitHub nem no Jira)',
    // Developer
    'Cards in parallel': 'Cards em paralelo',
    'Across all projects, the same project included. Each card has its own checkout and branch.':
      'Em todos os projetos, inclusive no mesmo projeto. Cada card tem seu próprio checkout e branch.',
    'Trigger and Jira flow': 'Gatilho e fluxo do Jira',
    'Trigger JQL': 'JQL de gatilho',
    "Applied within each project's board.": 'Aplicada dentro do board de cada projeto.',
    'When picked, move to': 'Ao pegar, mover para',
    'While waiting for a human': 'Enquanto aguarda uma pessoa',
    'When PRs are open': 'Quando os PRs estão abertos',
    'When PRs are merged': 'Quando os PRs recebem merge',
    'leave unchanged': 'não alterar',
    'The card is done then, and the agent stops following its PRs.': 'O card fica concluído e o agente deixa de acompanhar os PRs dele.',
    'Pull requests': 'Pull requests',
    'Default base branch': 'Branch base padrão',
    'Used when a project has none; empty uses the repository default.': 'Usada quando o projeto não define uma; vazio usa a padrão do repositório.',
    'Open PRs as': 'Abrir PRs como',
    'Ready for review': 'Pronto para revisão',
    Draft: 'Rascunho',
    Lead: 'Lead',
    'Coder subagent model': 'Modelo do subagente coder',
    'Tester subagent model': 'Modelo do subagente tester',
    'Claude lead only.': 'Só com lead Claude.',
    'Independent reviewers of the plan and the diff: none, one or both. With both, they review in parallel and each must approve.':
      'Revisores independentes do plano e do diff: nenhum, um ou os dois. Com os dois, revisam em paralelo e cada um precisa aprovar.',
    'First reviewer': 'Primeiro revisor',
    'Second reviewer': 'Segundo revisor',
    'No reviewer: plans and diffs go unreviewed; only the must-pass commands and the people on the PR check the work.':
      'Sem revisor: planos e diffs não são revisados; só os comandos obrigatórios e as pessoas no PR verificam o trabalho.',
    'Loop limits': 'Limites dos ciclos',
    'Plan review rounds': 'Rodadas de revisão do plano',
    'Fix attempts after a red verify': 'Tentativas de correção após verificação vermelha',
    'Diff review rounds': 'Rodadas de revisão do diff',
    'Rounds on a red PR before asking a human': 'Rodadas num PR vermelho antes de chamar uma pessoa',
    'Max minutes per run': 'Máximo de minutos por execução',
    // Approver
    'Reviews in parallel': 'Revisões em paralelo',
    // Dependabot
    'Cooldown (days)': 'Cooldown (dias)',
    'Merge only releases at least this old.': 'Só faz merge de releases com pelo menos essa idade.',
    'Merge method': 'Método de merge',
    Squash: 'Squash',
    'Merge commit': 'Merge commit',
    Rebase: 'Rebase',
    'Auto-merge updates': 'Merge automático de atualizações',
    'When CI fails': 'Quando o CI falha',
    "A PR in conflict, or failing while behind its base, gets {command}. Failing on an up-to-date branch, Dependabot can't fix it: a card on the project's board lets the Developer agent apply the update and fix what breaks (one card per PR).":
      'Um PR em conflito, ou falhando enquanto está atrás da base, recebe {command}. Se falha numa branch atualizada, o Dependabot não consegue corrigir: um card no board do projeto deixa o agente Developer aplicar a atualização e corrigir o que quebrar (um card por PR).',
    'Open a Jira card for the Developer (otherwise it goes to the inbox)': 'Abrir um card no Jira para o Developer (caso contrário, vai para a caixa de entrada)',
    'Issue type': 'Tipo de issue',
    Labels: 'Labels',
    "Comma-separated. Keep the one the Developer's trigger looks for (agent-ready by default).":
      'Separados por vírgula. Mantenha a que o gatilho do Developer procura (agent-ready por padrão).',
    'Move it to': 'Mover para',
    'The status the Developer picks cards from, if its trigger is a status. Empty leaves it as created.':
      'O status de onde o Developer pega os cards, se o gatilho dele for um status. Vazio deixa como foi criado.',
    'e.g. Ready for AI': 'ex.: Ready for AI',
    // Sentinel
    'The browser tools need Claude Code as the provider.': 'As ferramentas de navegador exigem o Claude Code como provedor.',
    'End-to-end tests run at (UTC)': 'Testes end-to-end rodam às (UTC)',
    "Pick a quiet hour: if the project's CI also tests this environment, keep the two apart.":
      'Escolha um horário tranquilo: se o CI do projeto também testa este ambiente, mantenha os dois separados.',
    'Explore every (hours)': 'Explorar a cada (horas)',
    'Only repositories whose branch moved since the last exploration.': 'Só repositórios cuja branch mudou desde a última exploração.',
    // Auditor
    Category: 'Categoria',
    'Every (days)': 'A cada (dias)',
    'Each enabled category is a full audit per repository: enabling many multiplies model usage.':
      'Cada categoria ativada é uma auditoria completa por repositório: ativar muitas multiplica o uso dos modelos.',
    'Repositories in parallel': 'Repositórios em paralelo',
    'All due categories of a repository run at once, on one shared checkout.': 'Todas as categorias pendentes de um repositório rodam juntas, num checkout compartilhado.',
    'Jira issue type for findings': 'Tipo de issue do Jira para achados',
    'Used by Create Jira card on the Findings page.': 'Usado por Criar card no Jira na página Achados.',
    // Team grid
    Agents: 'Agentes',
    'An agent runs only when it is enabled and everything it needs is configured.': 'Um agente só roda quando está ativado e tudo de que precisa está configurado.',
    working: 'trabalhando',
    // Agent overview
    'Auditing every enabled category of every repository now, each as its own run.': 'Auditando agora todas as categorias ativadas de todos os repositórios, cada uma em sua própria execução.',
    'Running the end-to-end suites and the explorations now.': 'Rodando agora as suítes end-to-end e as explorações.',
    'Assessing every open Dependabot PR again now, including the ones already handled.': 'Avaliando de novo agora todos os PRs abertos do Dependabot, inclusive os já tratados.',
    'Reviewing every PR that still requests your review now, including commits already reviewed.': 'Revisando agora todos os PRs que ainda pedem a sua revisão, inclusive commits já revisados.',
    'Looking for agent-ready cards now. Cards already picked are not redone (that would open a second PR).':
      'Procurando agora cards prontos para o agente. Cards já pegos não são refeitos (isso abriria um segundo PR).',
    State: 'Estado',
    Status: 'Status',
    Mode: 'Modo',
    'live: writes to GitHub and Jira': 'produção: escreve no GitHub e no Jira',
    'Last poll failed': 'A última verificação falhou',
    'Waiting for you': 'Aguardando você',
    '{n} in the inbox': '{n} na caixa de entrada',
    nothing: 'nada',
    'Run now': 'Rodar agora',
    'Stop everything {agent} is running now? The stopped items go to the inbox and are not picked up again until you Retry them. The agent stays on.':
      'Parar tudo o que o {agent} está rodando agora? Os itens interrompidos vão para a caixa de entrada e não são retomados até você usar Tentar de novo. O agente continua ligado.',
    'Stop running work': 'Parar o trabalho em andamento',
    'Last runs': 'Últimas execuções',
    'All runs': 'Todas as execuções',
    'No runs yet.': 'Nenhuma execução ainda.',
    // Agent page
    Overview: 'Visão geral',
    Settings: 'Configurações',
    Prompts: 'Prompts',
    'Changes apply on the next poll.': 'As mudanças valem a partir da próxima verificação.',
  },
  'es-ES': {
    // Model picker and save row
    'Pick from the list or type any id. Empty uses the provider default.': 'Elige de la lista o escribe cualquier id. Vacío usa el predeterminado del proveedor.',
    Provider: 'Proveedor',
    Model: 'Modelo',
    Ready: 'Listo',
    Save: 'Guardar',
    // Descriptions
    "Picks agent-ready cards from each project's Jira board, plans with the lead, has the reviewer check the plan and the diff, verifies with the repository commands and opens a PR per changed repository. Then it follows each PR until it is merged or closed: it answers every review comment (fixing it, or declining it with a justification) and keeps the pipeline green, including quality gates such as SonarQube. Merging stays with humans.":
      'Toma las tarjetas listas para el agente del tablero de Jira de cada proyecto, planifica con el lead, hace que el revisor compruebe el plan y el diff, verifica con los comandos del repositorio y abre un PR por repositorio modificado. Después sigue cada PR hasta que se fusiona o se cierra: responde a cada comentario de revisión (corrigiéndolo o rechazándolo con una justificación) y mantiene el pipeline en verde, incluidos los quality gates como SonarQube. El merge queda en manos de las personas.',
    'Reviews open PRs that request review directly from the GitHub user of this instance. Approves when there is nothing to suggest; otherwise comments inline.':
      'Revisa los PR abiertos que piden revisión directamente al usuario de GitHub de esta instancia. Aprueba cuando no hay nada que sugerir; si no, comenta en línea.',
    "Watches every repository of the projects under Projects. Merges Dependabot PRs when the release is older than the cooldown, checks are green, the repository's verify commands pass and the model finds no risk. Everything else goes to the inbox.":
      'Vigila todos los repositorios de los proyectos de Proyectos. Fusiona los PR de Dependabot cuando la release es más antigua que el cooldown, los checks están en verde, los comandos de verificación del repositorio pasan y el modelo no ve riesgo. Todo lo demás va a la bandeja de entrada.',
    "Once a day per project with a test environment (Projects → Test environment): runs the project's end-to-end suite (Playwright, Cucumber or Cypress, found in its repositories), runs each failed test again on its own to rule out flakiness, reproduces the ones that keep failing in a browser, and files the real bugs on the project's board with screenshots, the HAR and the steps, or comments on the open bug. Every few hours it also explores what changed in the repositories checked for it, and sends what it confirms to the inbox, where a person turns it into a card.":
      'Una vez al día en cada proyecto con entorno de pruebas (Proyectos → Entorno de pruebas): ejecuta la suite end-to-end del proyecto (Playwright, Cucumber o Cypress, encontrada en sus repositorios), vuelve a ejecutar por separado cada prueba fallida para descartar inestabilidad, reproduce en un navegador las que siguen fallando y registra los bugs reales en el tablero del proyecto con capturas, el HAR y los pasos, o comenta en el bug abierto. Cada pocas horas también explora lo que cambió en los repositorios marcados para él y envía lo que confirma a la bandeja de entrada, donde una persona lo convierte en tarjeta.',
    "Audits every repository of the projects under Projects on its base branch, one category at a time, each with its own skill, model and interval, and only when the branch has new commits since that category's last audit. Results go to the Findings page; critical and high findings also go to the inbox. Read-only on the code.":
      'Audita todos los repositorios de los proyectos de Proyectos en su branch base, una categoría cada vez, cada una con su propia skill, modelo e intervalo, y solo cuando la branch tiene commits nuevos desde la última auditoría de esa categoría. Los resultados van a la página Hallazgos; los hallazgos críticos y altos también van a la bandeja de entrada. Solo lectura sobre el código.',
    'In dry run an agent does all the work (models, verification) but writes nothing to GitHub or Jira; take agents live one at a time. Dry runs keep their own history, so going live does not skip real work.':
      'En dry run un agente hace todo el trabajo (modelos, verificación) pero no escribe nada en GitHub ni en Jira; pasa los agentes a producción de uno en uno. Los dry runs tienen su propio historial, así que pasar a producción no se salta trabajo real.',
    // Settings: common
    Enabled: 'Activado',
    'Dry run (writes nothing to GitHub or Jira)': 'Dry run (no escribe nada en GitHub ni en Jira)',
    // Developer
    'Cards in parallel': 'Tarjetas en paralelo',
    'Across all projects, the same project included. Each card has its own checkout and branch.':
      'En todos los proyectos, incluido el mismo proyecto. Cada tarjeta tiene su propio checkout y branch.',
    'Trigger and Jira flow': 'Disparador y flujo de Jira',
    'Trigger JQL': 'JQL de disparo',
    "Applied within each project's board.": 'Se aplica dentro del tablero de cada proyecto.',
    'When picked, move to': 'Al tomarla, mover a',
    'While waiting for a human': 'Mientras espera a una persona',
    'When PRs are open': 'Cuando los PR están abiertos',
    'When PRs are merged': 'Cuando los PR se fusionan',
    'leave unchanged': 'sin cambios',
    'The card is done then, and the agent stops following its PRs.': 'La tarjeta queda terminada y el agente deja de seguir sus PR.',
    'Pull requests': 'Pull requests',
    'Default base branch': 'Branch base predeterminada',
    'Used when a project has none; empty uses the repository default.': 'Se usa cuando un proyecto no tiene ninguna; vacío usa la predeterminada del repositorio.',
    'Open PRs as': 'Abrir PR como',
    'Ready for review': 'Listo para revisión',
    Draft: 'Borrador',
    Lead: 'Lead',
    'Coder subagent model': 'Modelo del subagente coder',
    'Tester subagent model': 'Modelo del subagente tester',
    'Claude lead only.': 'Solo con lead Claude.',
    'Independent reviewers of the plan and the diff: none, one or both. With both, they review in parallel and each must approve.':
      'Revisores independientes del plan y del diff: ninguno, uno o ambos. Con ambos, revisan en paralelo y cada uno debe aprobar.',
    'First reviewer': 'Primer revisor',
    'Second reviewer': 'Segundo revisor',
    'No reviewer: plans and diffs go unreviewed; only the must-pass commands and the people on the PR check the work.':
      'Sin revisor: los planes y diffs no se revisan; solo los comandos obligatorios y las personas en el PR verifican el trabajo.',
    'Loop limits': 'Límites de los ciclos',
    'Plan review rounds': 'Rondas de revisión del plan',
    'Fix attempts after a red verify': 'Intentos de corrección tras una verificación en rojo',
    'Diff review rounds': 'Rondas de revisión del diff',
    'Rounds on a red PR before asking a human': 'Rondas en un PR en rojo antes de avisar a una persona',
    'Max minutes per run': 'Máximo de minutos por ejecución',
    // Approver
    'Reviews in parallel': 'Revisiones en paralelo',
    // Dependabot
    'Cooldown (days)': 'Cooldown (días)',
    'Merge only releases at least this old.': 'Solo fusiona releases con al menos esta antigüedad.',
    'Merge method': 'Método de merge',
    Squash: 'Squash',
    'Merge commit': 'Merge commit',
    Rebase: 'Rebase',
    'Auto-merge updates': 'Fusionar automáticamente las actualizaciones',
    'When CI fails': 'Cuando falla el CI',
    "A PR in conflict, or failing while behind its base, gets {command}. Failing on an up-to-date branch, Dependabot can't fix it: a card on the project's board lets the Developer agent apply the update and fix what breaks (one card per PR).":
      'Un PR en conflicto, o que falla estando por detrás de su base, recibe {command}. Si falla en una branch actualizada, Dependabot no puede arreglarlo: una tarjeta en el tablero del proyecto permite al agente Developer aplicar la actualización y arreglar lo que se rompa (una tarjeta por PR).',
    'Open a Jira card for the Developer (otherwise it goes to the inbox)': 'Abrir una tarjeta de Jira para el Developer (si no, va a la bandeja de entrada)',
    'Issue type': 'Tipo de incidencia',
    Labels: 'Etiquetas',
    "Comma-separated. Keep the one the Developer's trigger looks for (agent-ready by default).":
      'Separadas por comas. Mantén la que busca el disparador del Developer (agent-ready por defecto).',
    'Move it to': 'Moverla a',
    'The status the Developer picks cards from, if its trigger is a status. Empty leaves it as created.':
      'El estado del que el Developer toma las tarjetas, si su disparador es un estado. Vacío la deja como se creó.',
    'e.g. Ready for AI': 'p. ej. Ready for AI',
    // Sentinel
    'The browser tools need Claude Code as the provider.': 'Las herramientas de navegador requieren Claude Code como proveedor.',
    'End-to-end tests run at (UTC)': 'Las pruebas end-to-end se ejecutan a las (UTC)',
    "Pick a quiet hour: if the project's CI also tests this environment, keep the two apart.":
      'Elige una hora tranquila: si el CI del proyecto también prueba este entorno, mantén ambos separados.',
    'Explore every (hours)': 'Explorar cada (horas)',
    'Only repositories whose branch moved since the last exploration.': 'Solo los repositorios cuya branch cambió desde la última exploración.',
    // Auditor
    Category: 'Categoría',
    'Every (days)': 'Cada (días)',
    'Each enabled category is a full audit per repository: enabling many multiplies model usage.':
      'Cada categoría activada es una auditoría completa por repositorio: activar muchas multiplica el uso de los modelos.',
    'Repositories in parallel': 'Repositorios en paralelo',
    'All due categories of a repository run at once, on one shared checkout.': 'Todas las categorías pendientes de un repositorio se ejecutan a la vez, en un checkout compartido.',
    'Jira issue type for findings': 'Tipo de incidencia de Jira para los hallazgos',
    'Used by Create Jira card on the Findings page.': 'Lo usa Crear tarjeta de Jira en la página Hallazgos.',
    // Team grid
    Agents: 'Agentes',
    'An agent runs only when it is enabled and everything it needs is configured.': 'Un agente solo se ejecuta cuando está activado y todo lo que necesita está configurado.',
    working: 'trabajando',
    // Agent overview
    'Auditing every enabled category of every repository now, each as its own run.': 'Auditando ahora todas las categorías activadas de todos los repositorios, cada una en su propia ejecución.',
    'Running the end-to-end suites and the explorations now.': 'Ejecutando ahora las suites end-to-end y las exploraciones.',
    'Assessing every open Dependabot PR again now, including the ones already handled.': 'Evaluando de nuevo ahora todos los PR abiertos de Dependabot, incluidos los ya tratados.',
    'Reviewing every PR that still requests your review now, including commits already reviewed.': 'Revisando ahora todos los PR que aún piden tu revisión, incluidos los commits ya revisados.',
    'Looking for agent-ready cards now. Cards already picked are not redone (that would open a second PR).':
      'Buscando ahora tarjetas listas para el agente. Las tarjetas ya tomadas no se rehacen (eso abriría un segundo PR).',
    State: 'Estado',
    Status: 'Estado',
    Mode: 'Modo',
    'live: writes to GitHub and Jira': 'producción: escribe en GitHub y Jira',
    'Last poll failed': 'La última consulta falló',
    'Waiting for you': 'Esperándote',
    '{n} in the inbox': '{n} en la bandeja de entrada',
    nothing: 'nada',
    'Run now': 'Ejecutar ahora',
    'Stop everything {agent} is running now? The stopped items go to the inbox and are not picked up again until you Retry them. The agent stays on.':
      '¿Detener todo lo que {agent} está ejecutando ahora? Los elementos detenidos van a la bandeja de entrada y no se retoman hasta que los reintentes. El agente sigue activo.',
    'Stop running work': 'Detener el trabajo en curso',
    'Last runs': 'Últimas ejecuciones',
    'All runs': 'Todas las ejecuciones',
    'No runs yet.': 'Aún no hay ejecuciones.',
    // Agent page
    Overview: 'Resumen',
    Settings: 'Ajustes',
    Prompts: 'Prompts',
    'Changes apply on the next poll.': 'Los cambios se aplican en la próxima consulta.',
  },
};

export default translations;
