const { ApiError } = require('./http');
const { parseId, parseUuid } = require('./validate');

const WORK_TYPES = ['STRENGTH', 'ISOMETRIC', 'CARDIO'];
const WEIGHT_UNITS = ['KG', 'LB'];
const CARDIO_METHODS = ['CONTINUOUS', 'INTERVAL_HIIT'];

function has(body, key) {
  return Object.prototype.hasOwnProperty.call(body, key);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPosInt(v) {
  return Number.isInteger(v) && v > 0;
}

function isNonNegInt(v) {
  return Number.isInteger(v) && v >= 0;
}

function isNonNegNumber(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

function validateRoutineMeta(body, { partial = false } = {}) {
  const errors = [];
  const data = {};

  if (!partial && !has(body, 'name')) {
    errors.push("El campo 'name' es obligatorio.");
  }
  if (has(body, 'name')) {
    if (typeof body.name !== 'string' || body.name.trim().length === 0 || body.name.trim().length > 150) {
      errors.push("El campo 'name' debe ser un texto de 1 a 150 caracteres.");
    } else {
      data.name = body.name.trim();
    }
  }

  if (has(body, 'description')) {
    if (body.description === null) {
      data.description = null;
    } else if (typeof body.description !== 'string') {
      errors.push("El campo 'description' debe ser un texto o null.");
    } else {
      data.description = body.description;
    }
  }

  for (const key of ['isTemplate', 'isActive']) {
    if (has(body, key)) {
      if (typeof body[key] !== 'boolean') {
        errors.push(`El campo '${key}' debe ser un booleano.`);
      } else {
        data[key] = body[key];
      }
    }
  }

  if (has(body, 'basedOnRoutineId')) {
    if (body.basedOnRoutineId === null) {
      data.basedOnRoutineId = null;
    } else {
      try {
        data.basedOnRoutineId = parseUuid(body.basedOnRoutineId, 'basedOnRoutineId');
      } catch (err) {
        errors.push(err.message);
      }
    }
  }

  if (errors.length) {
    throw new ApiError(400, 'Datos de entrada inválidos.', errors);
  }
  return data;
}

function validateDayPayload(body, { partial = false } = {}) {
  const errors = [];
  const data = {};

  if (!partial && !has(body, 'dayNumber')) {
    errors.push("El campo 'dayNumber' es obligatorio.");
  }
  if (has(body, 'dayNumber')) {
    try {
      data.dayNumber = parseId(body.dayNumber, 'dayNumber');
    } catch (err) {
      errors.push(err.message);
    }
  }

  if (!partial && !has(body, 'name')) {
    errors.push("El campo 'name' es obligatorio.");
  }
  if (has(body, 'name')) {
    if (typeof body.name !== 'string' || body.name.trim().length === 0 || body.name.trim().length > 100) {
      errors.push("El campo 'name' debe ser un texto de 1 a 100 caracteres.");
    } else {
      data.name = body.name.trim();
    }
  }

  if (has(body, 'description')) {
    if (body.description === null) {
      data.description = null;
    } else if (typeof body.description !== 'string') {
      errors.push("El campo 'description' debe ser un texto o null.");
    } else {
      data.description = body.description;
    }
  }

  if (errors.length) {
    throw new ApiError(400, 'Datos de entrada inválidos.', errors);
  }
  return data;
}

function validateStrengthDetails(details, errors) {
  const out = {};
  if (!isPosInt(details.sets)) errors.push("'details.sets' debe ser un entero mayor que 0.");
  else out.sets = details.sets;

  if (!isPosInt(details.reps)) errors.push("'details.reps' debe ser un entero mayor que 0.");
  else out.reps = details.reps;

  if (!isNonNegInt(details.restSeconds)) {
    errors.push("'details.restSeconds' debe ser un entero mayor o igual a 0.");
  } else {
    out.restSeconds = details.restSeconds;
  }

  if (details.suggestedWeight === undefined || details.suggestedWeight === null) {
    out.suggestedWeight = null;
    out.weightUnit = null;
  } else if (!isNonNegNumber(details.suggestedWeight)) {
    errors.push("'details.suggestedWeight' debe ser un número mayor o igual a 0.");
  } else {
    out.suggestedWeight = details.suggestedWeight;
    if (!WEIGHT_UNITS.includes(details.weightUnit)) {
      errors.push("'details.weightUnit' debe ser KG o LB cuando se indica peso.");
    } else {
      out.weightUnit = details.weightUnit;
    }
  }

  return out;
}

function validateIsometricDetails(details, errors) {
  const out = {};
  if (!isPosInt(details.sets)) errors.push("'details.sets' debe ser un entero mayor que 0.");
  else out.sets = details.sets;

  if (!isPosInt(details.holdSeconds)) errors.push("'details.holdSeconds' debe ser un entero mayor que 0.");
  else out.holdSeconds = details.holdSeconds;

  if (!isNonNegInt(details.restSeconds)) {
    errors.push("'details.restSeconds' debe ser un entero mayor o igual a 0.");
  } else {
    out.restSeconds = details.restSeconds;
  }

  return out;
}

function validateCardioDetails(details, errors) {
  const out = {
    durationSeconds: null,
    distanceMeters: null,
    intensity: null,
    method: null,
    intervalSeries: null,
    intervalWorkSeconds: null,
    intervalRestSeconds: null,
  };

  if (!CARDIO_METHODS.includes(details.method)) {
    errors.push("'details.method' debe ser CONTINUOUS o INTERVAL_HIIT.");
  } else {
    out.method = details.method;
  }

  if (details.durationSeconds !== undefined && details.durationSeconds !== null) {
    if (!isPosInt(details.durationSeconds)) errors.push("'details.durationSeconds' debe ser un entero mayor que 0.");
    else out.durationSeconds = details.durationSeconds;
  }

  if (details.distanceMeters !== undefined && details.distanceMeters !== null) {
    if (!(typeof details.distanceMeters === 'number' && Number.isFinite(details.distanceMeters) && details.distanceMeters > 0)) {
      errors.push("'details.distanceMeters' debe ser un número mayor que 0.");
    } else {
      out.distanceMeters = details.distanceMeters;
    }
  }

  if (out.durationSeconds === null && out.distanceMeters === null) {
    errors.push("'details' debe incluir 'durationSeconds' o 'distanceMeters'.");
  }

  if (details.intensity !== undefined && details.intensity !== null) {
    if (typeof details.intensity !== 'string') errors.push("'details.intensity' debe ser un texto o null.");
    else out.intensity = details.intensity;
  }

  for (const key of ['intervalSeries', 'intervalWorkSeconds', 'intervalRestSeconds']) {
    if (details[key] !== undefined && details[key] !== null) {
      const ok = key === 'intervalRestSeconds' ? isNonNegInt(details[key]) : isPosInt(details[key]);
      if (!ok) errors.push(`'details.${key}' tiene un valor inválido.`);
      else out[key] = details[key];
    }
  }

  if (out.method === 'INTERVAL_HIIT') {
    if (!isPosInt(details.intervalSeries)) errors.push("'details.intervalSeries' es obligatorio para INTERVAL_HIIT.");
    if (!isPosInt(details.intervalWorkSeconds)) errors.push("'details.intervalWorkSeconds' es obligatorio para INTERVAL_HIIT.");
    if (!isNonNegInt(details.intervalRestSeconds)) errors.push("'details.intervalRestSeconds' es obligatorio para INTERVAL_HIIT.");
  }

  return out;
}

function validateDetails(workType, details, errors) {
  if (!isPlainObject(details)) {
    errors.push("El campo 'details' es obligatorio y debe ser un objeto.");
    return null;
  }
  if (workType === 'STRENGTH') return validateStrengthDetails(details, errors);
  if (workType === 'ISOMETRIC') return validateIsometricDetails(details, errors);
  return validateCardioDetails(details, errors);
}

function validateExercisePayload(body, { partial = false, currentWorkType = null } = {}) {
  const errors = [];
  const data = {};

  const hasWorkType = has(body, 'workType');
  const effectiveWorkType = hasWorkType ? body.workType : currentWorkType;

  if (!partial && !hasWorkType) {
    errors.push("El campo 'workType' es obligatorio.");
  } else if (hasWorkType) {
    if (!WORK_TYPES.includes(body.workType)) {
      errors.push(`El campo 'workType' debe ser uno de: ${WORK_TYPES.join(', ')}.`);
    } else {
      data.workType = body.workType;
    }
  }

  if (!partial && !has(body, 'exerciseId')) {
    errors.push("El campo 'exerciseId' es obligatorio.");
  } else if (has(body, 'exerciseId')) {
    try {
      data.exerciseId = parseUuid(body.exerciseId, 'exerciseId');
    } catch (err) {
      errors.push(err.message);
    }
  }

  if (!partial && !has(body, 'orderIndex')) {
    errors.push("El campo 'orderIndex' es obligatorio.");
  } else if (has(body, 'orderIndex')) {
    try {
      data.orderIndex = parseId(body.orderIndex, 'orderIndex');
    } catch (err) {
      errors.push(err.message);
    }
  }

  if (has(body, 'notes')) {
    if (body.notes === null) {
      data.notes = null;
    } else if (typeof body.notes !== 'string') {
      errors.push("El campo 'notes' debe ser un texto o null.");
    } else {
      data.notes = body.notes;
    }
  }

  const hasDetails = has(body, 'details');
  if (!partial && !hasDetails) {
    errors.push("El campo 'details' es obligatorio.");
  }
  if (hasDetails) {
    if (effectiveWorkType) {
      data.details = validateDetails(effectiveWorkType, body.details, errors);
    }
  }

  if (partial && hasWorkType && !hasDetails && body.workType !== currentWorkType) {
    errors.push("Al cambiar 'workType' debe enviar 'details' del nuevo tipo.");
  }

  if (partial && Object.keys(data).length === 0) {
    errors.push('Debe proporcionar al menos un campo a actualizar.');
  }

  if (errors.length) {
    throw new ApiError(400, 'Datos de entrada inválidos.', errors);
  }
  return data;
}

function validateNestedDays(days) {
  if (!Array.isArray(days)) {
    throw new ApiError(400, 'Datos de entrada inválidos.', ["El campo 'days' debe ser un arreglo."]);
  }

  const result = [];
  const dayNumbers = new Set();

  days.forEach((day, i) => {
    if (!isPlainObject(day)) {
      throw new ApiError(400, 'Datos de entrada inválidos.', [`days[${i}] debe ser un objeto.`]);
    }
    const parsedDay = validateDayPayload(day, { partial: false });
    if (dayNumbers.has(parsedDay.dayNumber)) {
      throw new ApiError(400, 'Datos de entrada inválidos.', [`dayNumber duplicado: ${parsedDay.dayNumber}.`]);
    }
    dayNumbers.add(parsedDay.dayNumber);

    const list = day.exercises === undefined ? [] : day.exercises;
    if (!Array.isArray(list)) {
      throw new ApiError(400, 'Datos de entrada inválidos.', [`days[${i}].exercises debe ser un arreglo.`]);
    }

    const orders = new Set();
    const exercises = list.map((exercise, j) => {
      if (!isPlainObject(exercise)) {
        throw new ApiError(400, 'Datos de entrada inválidos.', [`days[${i}].exercises[${j}] debe ser un objeto.`]);
      }
      const parsed = validateExercisePayload(exercise, { partial: false });
      if (orders.has(parsed.orderIndex)) {
        throw new ApiError(400, 'Datos de entrada inválidos.', [
          `orderIndex duplicado en el día ${parsedDay.dayNumber}: ${parsed.orderIndex}.`,
        ]);
      }
      orders.add(parsed.orderIndex);
      return parsed;
    });

    result.push({ ...parsedDay, exercises });
  });

  return result;
}

function validateRoutineCreatePayload(body) {
  const data = validateRoutineMeta(body, { partial: false });
  data.days = body.days === undefined ? [] : validateNestedDays(body.days);
  return data;
}

function validateRoutineUpdatePayload(body) {
  const data = validateRoutineMeta(body, { partial: true });
  const hasDays = has(body, 'days');
  if (hasDays) {
    data.days = validateNestedDays(body.days);
  }
  if (!hasDays && Object.keys(data).length === 0) {
    throw new ApiError(400, 'Datos de entrada inválidos.', ['Debe proporcionar al menos un campo a actualizar.']);
  }
  return data;
}

module.exports = {
  validateRoutineCreatePayload,
  validateRoutineUpdatePayload,
  validateDayPayload,
  validateExercisePayload,
  WORK_TYPES,
  WEIGHT_UNITS,
  CARDIO_METHODS,
};
