const mysqlPool = require('../config/database');

/**
 * Get note by ID from MySQL database
 * GET /api/notes/:noteId
 * Returns only the NoteText value
 */
exports.getNoteById = async (req, res) => {
  try {
    const { noteId } = req.params;

    if (!noteId || !noteId.trim()) {
      return res.status(400).json({ 
        error: 'Invalid note ID', 
        message: 'Note ID cannot be empty' 
      });
    }

    // Secure parameterized query - prevents SQL injection
    const query = 'SELECT NoteText, NoteName FROM notes WHERE NoteId = ? LIMIT 1';
    const [rows] = await mysqlPool.query(query, [noteId.trim()]);

    if (!rows || rows.length === 0 || !rows[0].NoteText) {
      return res.status(404).json({ 
        error: 'Note not found', 
        message: `No note found with ID: ${noteId}` 
      });
    }

    res.json({ 
      NoteText: rows[0].NoteText,
      NoteName: rows[0].NoteName || null
    });

  } catch (error) {
    console.error(`❌ Error fetching note by ID (${req.params.noteId}):`, error.message);
    res.status(500).json({ 
      error: 'Database error', 
      message: 'Something went wrong'
    });
  }
};

