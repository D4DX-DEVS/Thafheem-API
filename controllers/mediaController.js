const mysqlPool = require('../config/database');

/**
 * Get media by NoteNo from MySQL database
 * GET /api/media/:noteNo
 * Returns mediasubject and Mediafile where NoteNo matches the parameter (M1, M2, etc.)
 */
exports.getMediaByNoteNo = async (req, res) => {
  try {
    const { noteNo } = req.params;

    if (!noteNo || !noteNo.trim()) {
      return res.status(400).json({ 
        error: 'Invalid NoteNo', 
        message: 'NoteNo cannot be empty' 
      });
    }

    // Secure parameterized query - prevents SQL injection
    const query = 'SELECT mediasubject, Mediafile FROM medias WHERE NoteNo = ?';
    const [rows] = await mysqlPool.query(query, [noteNo.trim()]);

    if (!rows || rows.length === 0) {
      return res.status(404).json({ 
        error: 'Media not found', 
        message: `No media found with NoteNo: ${noteNo}` 
      });
    }

    // Return array of media objects
    res.json(rows.map(row => ({
      mediasubject: row.mediasubject || null,
      Mediafile: row.Mediafile || null
    })));

  } catch (error) {
    console.error(`❌ Error fetching media by NoteNo (${req.params.noteNo}):`, error.message);
    res.status(500).json({ 
      error: 'Database error', 
      message: 'Something went wrong'
    });
  }
};


