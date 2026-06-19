const express = require('express');
const router = express.Router();

// Masters routes will be implemented in Phase 1 - Module 1B
// Placeholder to prevent app startup failure
router.get('/ping', (req, res) => res.json({ success: true, message: 'Masters module placeholder' }));

module.exports = router;
