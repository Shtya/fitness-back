import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
  

@Controller('conaching')
export class ConachingController {
  constructor(private readonly conachingService: any) {}

  @Post()
  create(@Body() createConachingDto: any) {
    return this.conachingService.create(createConachingDto);
  }

  @Get()
  findAll() {
    return this.conachingService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.conachingService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateConachingDto: any) {
    return this.conachingService.update(+id, updateConachingDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.conachingService.remove(+id);
  }
}
