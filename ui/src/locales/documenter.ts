/**
 * The Documenter agent's page (Team → Documenter). Shape: Translations in i18n.tsx (no import, so the server's
 * tests can load this file as it is).
 */
const translations = {
  'pt-BR': {
    'Documents every repository of the projects under Projects: architecture, modules, data model, entry points, security, state machines, critical flows, technical debt and one file per business domain, with Mermaid diagrams and a code reference for every rule. The first run writes it all; later ones update what the new commits touched. It writes only in the docs folder and opens one PR per repository, updating it while it is open. Merging stays with humans.':
      'Documenta cada repositório dos projetos em Projetos: arquitetura, módulos, modelo de dados, pontos de entrada, segurança, máquinas de estado, fluxos críticos, dívida técnica e um arquivo por domínio de negócio, com diagramas Mermaid e referência ao código para cada regra. A primeira execução escreve tudo; as seguintes atualizam o que os commits novos afetaram. Escreve só na pasta de docs e abre um PR por repositório, atualizando-o enquanto estiver aberto. O merge fica com as pessoas.',
    'Documenting every repository now, whatever its interval or last commit.': 'Documentando todos os repositórios agora, independentemente do intervalo ou do último commit.',
    'Docs folder': 'Pasta de docs',
    'Inside each repository; the agent writes only there and the platform reverts anything else. Other files in it are kept.':
      'Dentro de cada repositório; o agente escreve só ali e a plataforma desfaz qualquer outra alteração. Os outros arquivos da pasta são mantidos.',
    'Only when the base branch has new commits since the last docs. Run now documents every repository at once.':
      'Só quando a branch base tem commits novos desde a última documentação. O Run now documenta todos os repositórios de uma vez.',
  },
  'es-ES': {
    'Documents every repository of the projects under Projects: architecture, modules, data model, entry points, security, state machines, critical flows, technical debt and one file per business domain, with Mermaid diagrams and a code reference for every rule. The first run writes it all; later ones update what the new commits touched. It writes only in the docs folder and opens one PR per repository, updating it while it is open. Merging stays with humans.':
      'Documenta cada repositorio de los proyectos en Proyectos: arquitectura, módulos, modelo de datos, puntos de entrada, seguridad, máquinas de estado, flujos críticos, deuda técnica y un archivo por dominio de negocio, con diagramas Mermaid y una referencia al código para cada regla. La primera ejecución lo escribe todo; las siguientes actualizan lo que tocaron los commits nuevos. Escribe solo en la carpeta de docs y abre un PR por repositorio, actualizándolo mientras siga abierto. El merge queda en manos de las personas.',
    'Documenting every repository now, whatever its interval or last commit.': 'Documentando todos los repositorios ahora, sin importar el intervalo ni el último commit.',
    'Docs folder': 'Carpeta de docs',
    'Inside each repository; the agent writes only there and the platform reverts anything else. Other files in it are kept.':
      'Dentro de cada repositorio; el agente solo escribe ahí y la plataforma revierte cualquier otro cambio. Los demás archivos de la carpeta se conservan.',
    'Only when the base branch has new commits since the last docs. Run now documents every repository at once.':
      'Solo cuando la rama base tiene commits nuevos desde la última documentación. Run now documenta todos los repositorios a la vez.',
  },
};

export default translations;
