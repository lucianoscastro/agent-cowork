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
    'Add, edit or delete notes here, or in Obsidian: mount this folder on the host and open it as a vault:':
      'Adicione, edite ou apague notas aqui, ou no Obsidian: monte esta pasta no host e abra-a como vault:',
    'New note': 'Nova nota',
    Edit: 'Editar',
    Delete: 'Excluir',
    Path: 'Caminho',
    Note: 'Nota',
    'Lowercase folders and a file name with dashes, ending in .md, like database/rls.md.': 'Pastas e nome de arquivo em minúsculas, com hífens, terminando em .md, como database/rls.md.',
    'Markdown with the front matter Obsidian reads (tags, repos). Every agent of the project reads it as data: never write a password, token or connection string here.':
      'Markdown com o front matter que o Obsidian lê (tags, repos). Todo agente do projeto lê a nota como dado: nunca escreva aqui uma senha, token ou connection string.',
    'Discard your changes to this note?': 'Descartar suas alterações nesta nota?',
    'Delete the note {path}? Agents stop reading it, and this cannot be undone.': 'Excluir a nota {path}? Os agentes deixam de lê-la, e isso não pode ser desfeito.',
    'The path must be lowercase folders and a file name with dashes, ending in .md, at most three levels deep, like database/rls.md':
      'O caminho deve ter pastas e nome de arquivo em minúsculas, com hífens, terminando em .md, em até três níveis, como database/rls.md',
    'The note is empty': 'A nota está vazia',
    'The note is too long': 'A nota é longa demais',
    'This looks like it holds a credential: name the setting or variable instead': 'Isto parece conter uma credencial: cite o nome da configuração ou variável em vez do valor',
    'This note changed since you opened it: open it again to see what changed': 'Esta nota mudou desde que você a abriu: abra de novo para ver o que mudou',
    'A note with this path already exists': 'Já existe uma nota com este caminho',
    'The index cannot be deleted': 'O índice não pode ser excluído',
    'No project yet: add one in Projects.': 'Nenhum projeto ainda: adicione um em Projetos.',
    Project: 'Projeto',
    Notes: 'Notas',
    Graph: 'Grafo',
    'Each note and the notes it links to with [[…]]. Click a note to read it.': 'Cada nota e as notas a que ela liga com [[…]]. Clique numa nota para lê-la.',
    'Graph of the notes and their links': 'Grafo das notas e seus links',
    'Nothing learned yet: notes appear after runs where people answered or reviewed, or a review finding or a failing build was fixed. You can also add one with New note.':
      'Nada aprendido ainda: as notas aparecem depois de runs em que pessoas responderam ou revisaram, ou em que um achado de revisão ou um build quebrado foi corrigido. Você também pode adicionar uma em Nova nota.',
  },
  'es-ES': {
    Brain: 'Cerebro',
    'Download vault': 'Descargar vault',
    'What the agents learned on each project: one Markdown note per lesson, read by every run of the project before it starts.':
      'Lo que los agentes aprendieron en cada proyecto: una nota Markdown por lección, que lee cada ejecución del proyecto antes de empezar.',
    'Add, edit or delete notes here, or in Obsidian: mount this folder on the host and open it as a vault:':
      'Añade, edita o borra notas aquí, o en Obsidian: monta esta carpeta en el host y ábrela como vault:',
    'New note': 'Nueva nota',
    Edit: 'Editar',
    Delete: 'Eliminar',
    Path: 'Ruta',
    Note: 'Nota',
    'Lowercase folders and a file name with dashes, ending in .md, like database/rls.md.': 'Carpetas y nombre de archivo en minúsculas, con guiones, terminado en .md, como database/rls.md.',
    'Markdown with the front matter Obsidian reads (tags, repos). Every agent of the project reads it as data: never write a password, token or connection string here.':
      'Markdown con el front matter que lee Obsidian (tags, repos). Todos los agentes del proyecto la leen como dato: nunca escribas aquí una contraseña, token o cadena de conexión.',
    'Discard your changes to this note?': '¿Descartar tus cambios en esta nota?',
    'Delete the note {path}? Agents stop reading it, and this cannot be undone.': '¿Eliminar la nota {path}? Los agentes dejan de leerla, y no se puede deshacer.',
    'The path must be lowercase folders and a file name with dashes, ending in .md, at most three levels deep, like database/rls.md':
      'La ruta debe tener carpetas y nombre de archivo en minúsculas, con guiones, terminado en .md, en hasta tres niveles, como database/rls.md',
    'The note is empty': 'La nota está vacía',
    'The note is too long': 'La nota es demasiado larga',
    'This looks like it holds a credential: name the setting or variable instead': 'Esto parece contener una credencial: nombra la configuración o variable en lugar del valor',
    'This note changed since you opened it: open it again to see what changed': 'Esta nota cambió desde que la abriste: ábrela de nuevo para ver qué cambió',
    'A note with this path already exists': 'Ya existe una nota con esta ruta',
    'The index cannot be deleted': 'El índice no se puede eliminar',
    'No project yet: add one in Projects.': 'Aún no hay proyectos: añade uno en Proyectos.',
    Project: 'Proyecto',
    Notes: 'Notas',
    Graph: 'Grafo',
    'Each note and the notes it links to with [[…]]. Click a note to read it.': 'Cada nota y las notas a las que enlaza con [[…]]. Haz clic en una nota para leerla.',
    'Graph of the notes and their links': 'Grafo de las notas y sus enlaces',
    'Nothing learned yet: notes appear after runs where people answered or reviewed, or a review finding or a failing build was fixed. You can also add one with New note.':
      'Aún no se aprendió nada: las notas aparecen tras ejecuciones en que personas respondieron o revisaron, o se corrigió un hallazgo de revisión o un build roto. También puedes añadir una con Nueva nota.',
  },
};

export default translations;
