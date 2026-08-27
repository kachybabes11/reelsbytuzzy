import {
  createHourlyPackage,
  deleteHourlyPackage,
  findAllHourlyPackages,
  findHourlyPackageById,
  findHourlyPackageBySlug,
  updateHourlyPackage,
} from "../models/hourlyPackageModel.js";

export async function getHourlyPackages() {
  return findAllHourlyPackages({ activeOnly: true });
}

export async function getAllHourlyPackagesAdmin() {
  return findAllHourlyPackages({ activeOnly: false });
}

export async function getHourlyPackageById(id) {
  return findHourlyPackageById(id);
}

export async function getHourlyPackageBySlug(slug) {
  return findHourlyPackageBySlug(slug);
}

export async function addHourlyPackage(data) {
  return createHourlyPackage(data);
}

export async function editHourlyPackage(id, data) {
  return updateHourlyPackage(id, data);
}

export async function removeHourlyPackage(id) {
  return deleteHourlyPackage(id);
}
