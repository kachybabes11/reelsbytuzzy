import {
  createUser as createUserModel,
  findOrCreateGoogleUser as findOrCreateGoogleUserModel,
  getActivePasswordResetTokenByHash as getActivePasswordResetTokenByHashModel,
  getUserByEmail as getUserByEmailModel,
  getUserById as getUserByIdModel,
  createPasswordResetToken as createPasswordResetTokenModel,
  markPasswordResetTokenUsed as markPasswordResetTokenUsedModel,
  updateUserPasswordById as updateUserPasswordByIdModel,
} from "../models/authModel.js";

export async function getUserByEmail(email) {
  return getUserByEmailModel(email);
}

export async function getUserById(id) {
  return getUserByIdModel(id);
}

export async function createUser(email, password, googleId = null) {
  return createUserModel(email, password, googleId);
}

export async function findOrCreateGoogleUser(email, googleId) {
  return findOrCreateGoogleUserModel(email, googleId);
}

export async function createPasswordResetToken(userId, tokenHash, expiresAt) {
  return createPasswordResetTokenModel(userId, tokenHash, expiresAt);
}

export async function getActivePasswordResetTokenByHash(tokenHash) {
  return getActivePasswordResetTokenByHashModel(tokenHash);
}

export async function markPasswordResetTokenUsed(tokenId) {
  return markPasswordResetTokenUsedModel(tokenId);
}

export async function updateUserPasswordById(userId, hashedPassword) {
  return updateUserPasswordByIdModel(userId, hashedPassword);
}
