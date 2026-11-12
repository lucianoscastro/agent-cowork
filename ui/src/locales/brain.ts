/**
 * The Brain page (Work → Brain). Shape: Translations in i18n.tsx (no import, so the server's tests can load
 * this file as it is).
 */
const translations = {
  'pt-BR': {
    Brain: 'Cérebro',
    'Download vault': 'Baixar vault',
    'What the agents learned on each project: one Markdown note per lesson, read by every run of the project before it starts.':
      'O que os agentes aprenderam em cada projeto: uma nota Markdown por lição, lida por todo run do projeto antes de começar.',
    'Edit or delete notes in Obsidian: mount this folder on the host and open it as a vault:': 'Edite ou apague notas no Obsidian: monte esta pasta no host e abra-a como vault:',
    'No project yet: add one in Projects.': 'Nenhum projeto ainda: adicione um em Projetos.',
    Project: 'Projeto',
    Notes: 'Notas',
    Graph: 'Grafo',
    'Each note and the notes it links to with [[…]]. Click a note to read it.': 'Cada nota e as notas a que ela liga com [[…]]. Clique numa nota para lê-la.',
    'Graph of the notes and their links': 'Grafo das notas e seus links',
    'Nothing learned yet: notes appear after runs where people answered or reviewed, or a review finding or a failing build was fixed.':
      'Nada aprendido ainda: as notas aparecem depois de runs em que pessoas responderam ou revisaram, ou em que um achado de revisão ou um build quebrado foi corrigido.',
  },
  'es-ES': {
    Brain: 'Cerebro',
    'Download vault': 'Descargar vault',
    'What the agents learned on each project: one Markdown note per lesson, read by every run of the project before it starts.':
      'Lo que los agentes aprendieron en cada proyecto: una nota Markdown por lección, que lee cada ejecución del proyecto antes de empezar.',
    'Edit or delete notes in Obsidian: mount this folder on the host and open it as a vault:': 'Edita o borra notas en Obsidian: monta esta carpeta en el host y ábrela como vault:',
    'No project yet: add one in Projects.': 'Aún no hay proyectos: añade uno en Proyectos.',
    Project: 'Proyecto',
    Notes: 'Notas',
    Graph: 'Grafo',
    'Each note and the notes it links to with [[…]]. Click a note to read it.': 'Cada nota y las notas a las que enlaza con [[…]]. Haz clic en una nota para leerla.',
    'Graph of the notes and their links': 'Grafo de las notas y sus enlaces',
    'Nothing learned yet: notes appear after runs where people answered or reviewed, or a review finding or a failing build was fixed.':
      'Aún no se aprendió nada: las notas aparecen tras ejecuciones en que personas respondieron o revisaron, o se corrigió un hallazgo de revisión o un build roto.',
  },
};

export default translations;
