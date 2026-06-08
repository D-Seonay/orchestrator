import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const AddProjectModal = ({ isOpen, onClose, onAdd }) => {
  const [formData, setFormData] = useState({
    name: '',
    script: '',
    args: '',
    cwd: ''
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onAdd({
      ...formData,
      args: formData.args.split(' ').filter(arg => arg !== '')
    });
    setFormData({ name: '', script: '', args: '', cwd: '' });
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div 
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div 
            className="modal-content"
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          >
            <div className="modal-header">
              <h2>NEW_DEPLOYMENT</h2>
              <button className="close-button" onClick={onClose}>&times;</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>PROJECT_NAME</label>
                <input 
                  type="text" 
                  required 
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g. AUTH-SERVICE"
                />
              </div>
              <div className="form-group">
                <label>LAUNCH_SCRIPT</label>
                <input 
                  type="text" 
                  required 
                  value={formData.script}
                  onChange={(e) => setFormData({ ...formData, script: e.target.value })}
                  placeholder="e.g. node index.js"
                />
              </div>
              <div className="form-group">
                <label>ARGUMENTS</label>
                <input 
                  type="text" 
                  value={formData.args}
                  onChange={(e) => setFormData({ ...formData, args: e.target.value })}
                  placeholder="e.g. --port 3000"
                />
              </div>
              <div className="form-group">
                <label>WORKING_DIR</label>
                <input 
                  type="text" 
                  value={formData.cwd}
                  onChange={(e) => setFormData({ ...formData, cwd: e.target.value })}
                  placeholder="./services/auth"
                />
              </div>
              <button type="submit" className="submit-button">INITIATE_DEPLOYMENT</button>
            </form>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default AddProjectModal;
