import { BadRequestException, ConflictException, NotFoundException, HttpException, HttpStatus } from '@nestjs/common';


const statusMessages = {
  400: "Bad Request",
  401: "Unauthorized",
  404: "Not Found",
  500: "Internal Server Error",
  429: "Too Many Requests"
  // Add other status codes as needed
};


export async function checkFieldExists(
  repository: { findOne: (options: any) => Promise<any> },
  query: Record<string, any>, 
  message: string,
  negativeCondition?: boolean ,
  status: HttpStatus = HttpStatus.BAD_REQUEST
) {

  const errorMessage = statusMessages[status] || "Unknown Error";
  const entity = await repository.findOne({ where: query }); // Query the database

  if (negativeCondition) {
    if (!entity) throw new HttpException({ message , error : errorMessage , statusCode : status  }, status);
  } else {
    if (entity) throw new HttpException({ message , error : errorMessage , statusCode : status  }, status);
  }
}


export function globalError(message: string, status: HttpStatus = HttpStatus.INTERNAL_SERVER_ERROR) {
  const errorMessage = statusMessages[status] || "Unknown Error";
  throw new HttpException({ message , error : errorMessage , statusCode : status  }, status);
}