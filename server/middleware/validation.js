const { body, param, query, validationResult } = require('express-validator');

function handleValidationErrors(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Datos de entrada inválidos',
      details: errors.array().map(e => ({
        field: e.param,
        message: e.msg,
        value: e.value,
      })),
    });
  }
  next();
}

function validate(rules) {
  return [...rules, handleValidationErrors];
}

module.exports = {
  body,
  param,
  query,
  validate,
};
